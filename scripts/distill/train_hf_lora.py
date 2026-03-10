#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Local HF LoRA SFT trainer for distillation pilot.")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--max-steps", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--lora-r", type=int, default=8)
    parser.add_argument("--lora-alpha", type=int, default=16)
    args = parser.parse_args()

    dataset_path = Path(args.dataset).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not dataset_path.exists():
        fail(f"dataset not found: {dataset_path}", 2)

    rows = load_jsonl(dataset_path)
    if not rows:
        fail("dataset is empty", 3)

    try:
        import torch
        from datasets import Dataset
        from peft import LoraConfig, TaskType, get_peft_model
        from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments
    except Exception as exc:  # pragma: no cover
        fail(f"trainer dependencies unavailable: {exc}", 4)

    device = "cpu"
    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"

    torch_dtype = torch.float16 if device in {"cuda", "mps"} else torch.float32
    print(f"[distill-trainer] loading model={args.model} device={device} dtype={torch_dtype}")

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

    lora_config = LoraConfig(
        r=max(1, args.lora_r),
        lora_alpha=max(1, args.lora_alpha),
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "up_proj", "down_proj", "gate_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)

    def to_text(item: dict[str, Any]) -> str:
        instruction = str(item.get("instruction", "")).strip()
        input_text = str(item.get("input", "")).strip()
        output_text = str(item.get("output", "")).strip()
        prompt = f"### Instruction\n{instruction}\n\n### Input\n{input_text}\n\n### Response\n{output_text}"
        return prompt

    texts = [{"text": to_text(row)} for row in rows]
    dataset = Dataset.from_list(texts)

    def tokenize(example: dict[str, Any]) -> dict[str, Any]:
        encoded = tokenizer(
            str(example["text"]),
            truncation=True,
            padding="max_length",
            max_length=1024,
        )
        encoded["labels"] = encoded["input_ids"].copy()
        return encoded

    tokenized = dataset.map(tokenize, remove_columns=["text"])

    training_args = TrainingArguments(
        output_dir=str(output_dir),
        overwrite_output_dir=True,
        max_steps=max(1, args.max_steps),
        per_device_train_batch_size=max(1, args.batch_size),
        gradient_accumulation_steps=max(1, args.grad_accum),
        learning_rate=max(1e-7, float(args.learning_rate)),
        warmup_ratio=0.03,
        logging_steps=1,
        save_steps=max(1, args.max_steps // 2),
        save_total_limit=2,
        bf16=False,
        fp16=device == "cuda",
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        tokenizer=tokenizer,
    )

    started = time.time()
    train_result = trainer.train()
    wall_clock = time.time() - started

    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))

    metrics = {
        "train_loss_final": float(getattr(train_result, "training_loss", 0.0)),
        "eval_loss": None,
        "tokens_seen": int(len(rows) * 1024),
        "wall_clock_sec": round(wall_clock, 3),
        "checkpoint_path": str(output_dir),
        "max_steps": int(args.max_steps),
        "sample_count": len(rows),
    }
    with (output_dir / "metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2)

    report = {
        "model": args.model,
        "dataset": str(dataset_path),
        "output_dir": str(output_dir),
        "device": device,
        "lora": {
            "r": int(args.lora_r),
            "alpha": int(args.lora_alpha),
        },
        "trainer": {
            "max_steps": int(args.max_steps),
            "batch_size": int(args.batch_size),
            "grad_accum": int(args.grad_accum),
            "learning_rate": float(args.learning_rate),
        },
        "metrics": metrics,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with (output_dir / "training_report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

    print(f"[distill-trainer] completed in {wall_clock:.2f}s with {len(rows)} examples")


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()

