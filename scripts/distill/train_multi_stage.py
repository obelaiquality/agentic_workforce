#!/usr/bin/env python3
from __future__ import annotations

import argparse
import inspect
import json
import math
import os
import random
import sys
import time
from pathlib import Path
from typing import Any


def fail(message: str, code: int = 1) -> None:
    print(f"[distill-trainer] {message}", file=sys.stderr)
    sys.exit(code)


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if not raw:
                continue
            rows.append(json.loads(raw))
    return rows


def build_prompt(row: dict[str, Any], output_override: str | None = None) -> str:
    instruction = str(row.get("instruction", "")).strip()
    input_text = str(row.get("input", "")).strip()
    output_text = (
        str(output_override).strip()
        if output_override is not None
        else str(row.get("output", "")).strip()
    )
    return (
        "### Instruction\n"
        f"{instruction}\n\n"
        "### Input\n"
        f"{input_text}\n\n"
        "### Response\n"
        f"{output_text}"
    )


def make_rejected_output(output_text: str) -> str:
    clean = output_text.strip()
    if not clean:
        return "I cannot complete this task safely."

    lines = [line.strip() for line in clean.splitlines() if line.strip()]
    if len(lines) >= 3:
        return "\n".join(lines[:1] + ["Steps: skipped validation.", "Checks: none"])
    if len(clean.split()) > 12:
        return "Minimal response without tests, checks, or citations."
    return "Not enough context to proceed."


def reward_score(output_text: str) -> float:
    text = output_text.lower()
    reward = 0.0
    if "check" in text or "validation" in text:
        reward += 1.0
    if "test" in text:
        reward += 1.0
    if "citation" in text or "retrieval" in text or "source" in text:
        reward += 0.7
    if "rollback" in text or "safety" in text or "policy" in text:
        reward += 0.8
    if "rm -rf" in text or "drop table" in text or "disable auth" in text:
        reward -= 3.0
    if len(text.split()) < 24:
        reward -= 0.7
    return reward


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    return parsed if math.isfinite(parsed) else default


def sanitize_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: sanitize_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_json(item) for item in value]
    if isinstance(value, float):
        return value if math.isfinite(value) else 0.0
    return value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Multi-stage local distillation trainer.")
    parser.add_argument("--stage", required=True, choices=["sft", "orpo", "tool_rl"])
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--init-adapter-path", default=None)
    parser.add_argument("--max-steps", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--lora-r", type=int, default=8)
    parser.add_argument("--lora-alpha", type=int, default=16)
    parser.add_argument("--max-seq-length", type=int, default=1024)
    parser.add_argument("--orpo-beta", type=float, default=0.1)
    parser.add_argument("--tool-reward-scale", type=float, default=0.6)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def set_seed(seed: int) -> None:
    random.seed(seed)
    try:
        import torch

        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
    except Exception:
        return


def detect_device(torch_module: Any) -> str:
    if torch_module.cuda.is_available():
        return "cuda"
    if torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def avg_seq_logprob_from_logits(logits: Any, input_ids: Any, attention_mask: Any, torch_module: Any) -> Any:
    shift_logits = logits[:, :-1, :]
    shift_labels = input_ids[:, 1:]
    shift_mask = attention_mask[:, 1:].to(shift_logits.dtype)
    token_log_probs = torch_module.nn.functional.log_softmax(shift_logits, dim=-1)
    token_log_probs = torch_module.nan_to_num(token_log_probs, nan=-20.0, posinf=20.0, neginf=-20.0)
    gathered = token_log_probs.gather(dim=-1, index=shift_labels.unsqueeze(-1)).squeeze(-1)
    masked = gathered * shift_mask
    denom = shift_mask.sum(dim=1).clamp(min=1.0)
    return masked.sum(dim=1) / denom


def load_train_components(args: argparse.Namespace, rows: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        import torch
        from datasets import Dataset
        from peft import LoraConfig, PeftModel, TaskType, get_peft_model
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except Exception as exc:  # pragma: no cover
        fail(f"trainer dependencies unavailable: {exc}", 4)

    if not rows:
        fail("dataset is empty", 3)

    device = detect_device(torch)
    torch_dtype = torch.float16 if device in {"cuda", "mps"} else torch.float32
    print(f"[distill-trainer] stage={args.stage} model={args.model} device={device} dtype={torch_dtype}")
    if device == "mps":
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None and tokenizer.eos_token is not None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        trust_remote_code=True,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
    )
    model.to(device)

    if args.init_adapter_path:
        model = PeftModel.from_pretrained(
            model,
            str(Path(args.init_adapter_path).expanduser().resolve()),
            is_trainable=True,
        )
    else:
        lora_config = LoraConfig(
            r=max(1, args.lora_r),
            lora_alpha=max(1, args.lora_alpha),
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "up_proj", "down_proj", "gate_proj"],
            lora_dropout=0.05,
            bias="none",
            task_type=TaskType.CAUSAL_LM,
        )
        model = get_peft_model(model, lora_config)

    if hasattr(model, "config"):
        model.config.use_cache = False
    if hasattr(model, "enable_input_require_grads"):
        model.enable_input_require_grads()
    if hasattr(model, "gradient_checkpointing_enable"):
        model.gradient_checkpointing_enable()

    return {
        "torch": torch,
        "Dataset": Dataset,
        "tokenizer": tokenizer,
        "model": model,
        "device": device,
    }


def run_sft(args: argparse.Namespace, rows: list[dict[str, Any]], components: dict[str, Any]) -> dict[str, Any]:
    from transformers import Trainer, TrainingArguments

    Dataset = components["Dataset"]
    tokenizer = components["tokenizer"]
    model = components["model"]
    device = components["device"]

    texts = [{"text": build_prompt(row)} for row in rows]
    dataset = Dataset.from_list(texts)

    def tokenize(example: dict[str, Any]) -> dict[str, Any]:
        encoded = tokenizer(
            str(example["text"]),
            truncation=True,
            padding="max_length",
            max_length=args.max_seq_length,
        )
        encoded["labels"] = encoded["input_ids"].copy()
        return encoded

    tokenized = dataset.map(tokenize, remove_columns=["text"])

    training_kwargs: dict[str, Any] = {
        "output_dir": str(args.output_dir),
        "max_steps": max(1, args.max_steps),
        "per_device_train_batch_size": max(1, args.batch_size),
        "gradient_accumulation_steps": max(1, args.grad_accum),
        "learning_rate": max(1e-7, float(args.learning_rate)),
        "warmup_ratio": 0.03,
        "logging_steps": 1,
        "save_steps": max(1, args.max_steps // 2),
        "save_total_limit": 2,
        "bf16": False,
        "fp16": device == "cuda",
        "dataloader_pin_memory": device == "cuda",
        "report_to": [],
    }
    if device != "cpu":
        training_kwargs["gradient_checkpointing"] = True

    signature = inspect.signature(TrainingArguments.__init__)
    if "overwrite_output_dir" in signature.parameters:
        training_kwargs["overwrite_output_dir"] = True

    filtered_kwargs = {key: value for key, value in training_kwargs.items() if key in signature.parameters}
    training_args = TrainingArguments(**filtered_kwargs)

    trainer_kwargs: dict[str, Any] = {
        "model": model,
        "args": training_args,
        "train_dataset": tokenized,
    }
    trainer_signature = inspect.signature(Trainer.__init__)
    if "tokenizer" in trainer_signature.parameters:
        trainer_kwargs["tokenizer"] = tokenizer
    elif "processing_class" in trainer_signature.parameters:
        trainer_kwargs["processing_class"] = tokenizer

    filtered_trainer_kwargs = {key: value for key, value in trainer_kwargs.items() if key in trainer_signature.parameters}
    trainer = Trainer(**filtered_trainer_kwargs)

    started = time.time()
    train_result = trainer.train()
    wall_clock = time.time() - started
    trainer.save_model(str(args.output_dir))
    tokenizer.save_pretrained(str(args.output_dir))

    return {
        "train_loss_final": safe_float(getattr(train_result, "training_loss", 0.0)),
        "wall_clock_sec": round(wall_clock, 3),
        "sample_count": len(rows),
    }


def run_orpo(args: argparse.Namespace, rows: list[dict[str, Any]], components: dict[str, Any]) -> dict[str, Any]:
    torch = components["torch"]
    tokenizer = components["tokenizer"]
    model = components["model"]
    device = components["device"]

    chosen_texts = [build_prompt(row) for row in rows]
    rejected_texts = [build_prompt(row, make_rejected_output(str(row.get("output", "")))) for row in rows]

    chosen = tokenizer(
        chosen_texts,
        truncation=True,
        padding="max_length",
        max_length=args.max_seq_length,
        return_tensors="pt",
    )
    rejected = tokenizer(
        rejected_texts,
        truncation=True,
        padding="max_length",
        max_length=args.max_seq_length,
        return_tensors="pt",
    )

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=max(1e-7, float(args.learning_rate)),
    )
    model.train()

    steps = max(1, args.max_steps)
    batch_size = max(1, args.batch_size)
    grad_accum = max(1, args.grad_accum)
    beta = max(1e-5, float(args.orpo_beta))
    losses: list[float] = []
    pref_losses: list[float] = []
    ce_losses: list[float] = []

    started = time.time()
    optimizer.zero_grad(set_to_none=True)
    for step in range(steps):
        idx = torch.randint(low=0, high=chosen["input_ids"].size(0), size=(batch_size,))

        c_ids = chosen["input_ids"][idx].to(device)
        c_mask = chosen["attention_mask"][idx].to(device)
        r_ids = rejected["input_ids"][idx].to(device)
        r_mask = rejected["attention_mask"][idx].to(device)

        c_outputs = model(input_ids=c_ids, attention_mask=c_mask, labels=c_ids)
        ce_loss = torch.nan_to_num(c_outputs.loss, nan=0.0, posinf=20.0, neginf=20.0)
        chosen_lp = torch.nan_to_num(avg_seq_logprob_from_logits(c_outputs.logits, c_ids, c_mask, torch), nan=-20.0, posinf=20.0, neginf=-20.0)

        r_outputs = model(input_ids=r_ids, attention_mask=r_mask)
        rejected_lp = torch.nan_to_num(avg_seq_logprob_from_logits(r_outputs.logits, r_ids, r_mask, torch), nan=-20.0, posinf=20.0, neginf=-20.0)

        pref_loss = -torch.nn.functional.logsigmoid(chosen_lp - rejected_lp).mean()
        pref_loss = torch.nan_to_num(pref_loss, nan=0.0, posinf=20.0, neginf=20.0)
        loss = torch.nan_to_num(ce_loss + beta * pref_loss, nan=0.0, posinf=20.0, neginf=20.0)
        (loss / grad_accum).backward()

        if (step + 1) % grad_accum == 0 or (step + 1) == steps:
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

        losses.append(safe_float(loss.detach().cpu()))
        ce_losses.append(safe_float(ce_loss.detach().cpu()))
        pref_losses.append(safe_float(pref_loss.detach().cpu()))

    wall_clock = time.time() - started
    model.save_pretrained(str(args.output_dir))
    tokenizer.save_pretrained(str(args.output_dir))

    return {
        "loss_final": losses[-1],
        "loss_avg": float(sum(losses) / len(losses)),
        "ce_loss_avg": float(sum(ce_losses) / len(ce_losses)),
        "preference_loss_avg": float(sum(pref_losses) / len(pref_losses)),
        "orpo_beta": beta,
        "wall_clock_sec": round(wall_clock, 3),
        "sample_count": len(rows),
    }


def run_tool_rl(args: argparse.Namespace, rows: list[dict[str, Any]], components: dict[str, Any]) -> dict[str, Any]:
    torch = components["torch"]
    tokenizer = components["tokenizer"]
    model = components["model"]
    device = components["device"]

    prompts = [build_prompt(row) for row in rows]
    rewards_raw = [reward_score(str(row.get("output", ""))) for row in rows]
    scale = max(0.01, float(args.tool_reward_scale))
    rewards = [max(0.05, 1.0 + scale * value) for value in rewards_raw]

    encoded = tokenizer(
        prompts,
        truncation=True,
        padding="max_length",
        max_length=args.max_seq_length,
        return_tensors="pt",
    )
    reward_tensor = torch.tensor(rewards, dtype=torch.float32)

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=max(1e-7, float(args.learning_rate)),
    )
    model.train()

    steps = max(1, args.max_steps)
    batch_size = max(1, args.batch_size)
    grad_accum = max(1, args.grad_accum)
    losses: list[float] = []
    started = time.time()
    optimizer.zero_grad(set_to_none=True)

    for step in range(steps):
        idx = torch.randint(low=0, high=encoded["input_ids"].size(0), size=(batch_size,))
        ids = encoded["input_ids"][idx].to(device)
        mask = encoded["attention_mask"][idx].to(device)
        weights = reward_tensor[idx].to(device)

        outputs = model(input_ids=ids, attention_mask=mask)
        logits = outputs.logits[:, :-1, :]
        labels = ids[:, 1:]
        label_mask = mask[:, 1:].to(logits.dtype)

        flat_loss = torch.nn.functional.cross_entropy(
            logits.reshape(-1, logits.size(-1)),
            labels.reshape(-1),
            reduction="none",
        ).reshape(labels.size(0), labels.size(1))
        per_example = (flat_loss * label_mask).sum(dim=1) / label_mask.sum(dim=1).clamp(min=1.0)
        weighted_loss = (per_example * weights).mean()

        (weighted_loss / grad_accum).backward()
        if (step + 1) % grad_accum == 0 or (step + 1) == steps:
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

        losses.append(safe_float(weighted_loss.detach().cpu()))

    wall_clock = time.time() - started
    model.save_pretrained(str(args.output_dir))
    tokenizer.save_pretrained(str(args.output_dir))

    return {
        "loss_final": losses[-1],
        "loss_avg": float(sum(losses) / len(losses)),
        "reward_avg": float(sum(rewards_raw) / max(1, len(rewards_raw))),
        "reward_min": float(min(rewards_raw)),
        "reward_max": float(max(rewards_raw)),
        "reward_scale": scale,
        "wall_clock_sec": round(wall_clock, 3),
        "sample_count": len(rows),
    }


def main() -> None:
    args = parse_args()
    set_seed(int(args.seed))

    dataset_path = Path(args.dataset).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not dataset_path.exists():
        fail(f"dataset not found: {dataset_path}", 2)

    rows = load_jsonl(dataset_path)
    if not rows:
        fail("dataset is empty", 3)

    components = load_train_components(args, rows)
    stage = str(args.stage)

    if stage == "sft":
        stage_metrics = run_sft(args, rows, components)
    elif stage == "orpo":
        stage_metrics = run_orpo(args, rows, components)
    elif stage == "tool_rl":
        stage_metrics = run_tool_rl(args, rows, components)
    else:  # pragma: no cover
        fail(f"unsupported stage: {stage}", 20)
        return

    metrics = {
        "stage": stage,
        "tokens_seen": int(len(rows) * args.max_seq_length),
        "checkpoint_path": str(output_dir),
        "max_steps": int(args.max_steps),
        **stage_metrics,
    }
    metrics = sanitize_json(metrics)
    with (output_dir / "metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2)

    report = {
        "stage": stage,
        "model": args.model,
        "dataset": str(dataset_path),
        "output_dir": str(output_dir),
        "trainer": {
            "max_steps": int(args.max_steps),
            "batch_size": int(args.batch_size),
            "grad_accum": int(args.grad_accum),
            "learning_rate": float(args.learning_rate),
            "lora_r": int(args.lora_r),
            "lora_alpha": int(args.lora_alpha),
            "max_seq_length": int(args.max_seq_length),
            "orpo_beta": float(args.orpo_beta),
            "tool_reward_scale": float(args.tool_reward_scale),
        },
        "metrics": metrics,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with (output_dir / "training_report.json").open("w", encoding="utf-8") as handle:
        json.dump(sanitize_json(report), handle, indent=2)

    print(f"[distill-trainer] stage={stage} completed with {len(rows)} examples")


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
