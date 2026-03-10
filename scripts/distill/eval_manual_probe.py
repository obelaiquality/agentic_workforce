#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


STOPWORDS = {
    "the",
    "and",
    "for",
    "that",
    "with",
    "this",
    "from",
    "into",
    "then",
    "than",
    "when",
    "where",
    "must",
    "should",
    "would",
    "have",
    "has",
    "had",
    "your",
    "their",
    "there",
    "about",
    "after",
    "before",
    "only",
    "keep",
    "read",
    "patch",
    "note",
    "citations",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Held-out manual probe evaluator for local distill runs.")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--adapter-path", default=None)
    parser.add_argument("--baseline-model-id", default=None)
    parser.add_argument("--max-samples", type=int, default=8)
    parser.add_argument("--max-new-tokens", type=int, default=192)
    return parser.parse_args()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            raw = line.strip()
            if raw:
                rows.append(json.loads(raw))
    return rows


def detect_device(torch_module: Any) -> str:
    if torch_module.cuda.is_available():
        return "cuda"
    if torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def build_prompt(row: dict[str, Any]) -> str:
    instruction = str(row.get("instruction", "")).strip() or "Respond safely to the request."
    input_text = str(row.get("input", "")).strip() or "No additional context."
    return (
        "### Instruction\n"
        f"{instruction}\n\n"
        "### Input\n"
        f"{input_text}\n\n"
        "### Response\n"
    )


def trim_completion(text: str) -> str:
    cleaned = text.strip()
    for marker in ("\n### Instruction", "\n### Input", "\n### Response"):
        if marker in cleaned:
            cleaned = cleaned.split(marker, 1)[0].strip()
    return cleaned


def extract_sections(text: str) -> set[str]:
    return set(re.findall(r"(?m)^([A-Za-z][A-Za-z ]+):", text))


def normalize_tokens(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9_]{4,}", text.lower()) if token not in STOPWORDS]


def is_degenerate(text: str) -> bool:
    cleaned = text.strip()
    if not cleaned:
        return True
    if re.search(r"(.)\1{15,}", cleaned):
        return True
    tokens = cleaned.split()
    if len(tokens) >= 8:
        uniqueness = len(set(tokens)) / max(1, len(tokens))
        if uniqueness < 0.2:
            return True
    punctuation = sum(1 for char in cleaned if char in "!?.#")
    if punctuation / max(1, len(cleaned)) > 0.45:
        return True
    alpha_chars = sum(1 for char in cleaned if char.isalpha())
    return alpha_chars < max(6, len(cleaned) // 10)


def compute_keyword_overlap(prediction: str, reference: str) -> float:
    predicted_tokens = set(normalize_tokens(prediction))
    reference_tokens = []
    for token in normalize_tokens(reference):
        if token not in reference_tokens:
            reference_tokens.append(token)
    focus = reference_tokens[:18]
    if not focus:
        return 0.0
    hits = sum(1 for token in focus if token in predicted_tokens)
    return hits / len(focus)


def evaluate_sample(row: dict[str, Any], prediction: str, latency_ms: float) -> dict[str, Any]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    rubric = metadata.get("benchmark_rubric") if isinstance(metadata.get("benchmark_rubric"), dict) else {}
    reference = str(row.get("output", "")).strip()
    required_sections = rubric.get("minSections") if isinstance(rubric.get("minSections"), list) else ["Summary", "Steps", "Checks"]
    required_terms = rubric.get("requiredTerms") if isinstance(rubric.get("requiredTerms"), list) else ["test"]
    banned_terms = rubric.get("bannedTerms") if isinstance(rubric.get("bannedTerms"), list) else []

    sections = extract_sections(prediction)
    section_score = sum(1 for item in required_sections if str(item) in sections) / max(1, len(required_sections))

    lowered = prediction.lower()
    required_term_score = (
        sum(1 for item in required_terms if str(item).lower() in lowered) / max(1, len(required_terms))
        if required_terms
        else 1.0
    )
    banned_hit = any(str(item).lower() in lowered for item in banned_terms)
    keyword_overlap = compute_keyword_overlap(prediction, reference)
    similarity = SequenceMatcher(None, prediction.lower(), reference.lower()).ratio()

    has_numbered_steps = len(re.findall(r"(?m)^\d+\.", prediction)) >= 3
    tool_success = ("Steps" in sections and "Checks" in sections and ("Artifacts" in sections or has_numbered_steps))
    degenerate = is_degenerate(prediction)
    policy_ok = not banned_hit and required_term_score >= 0.5
    sample_pass = (not degenerate) and policy_ok and tool_success and section_score >= 0.66 and keyword_overlap >= 0.12

    return {
      "specId": str(metadata.get("spec_id", "")),
      "latencyMs": round(latency_ms, 2),
      "sectionScore": round(section_score, 4),
      "requiredTermScore": round(required_term_score, 4),
      "keywordOverlap": round(keyword_overlap, 4),
      "similarity": round(similarity, 4),
      "degenerate": degenerate,
      "policyOk": policy_ok,
      "toolSuccess": tool_success,
      "pass": sample_pass,
      "prediction": prediction,
    }


def percentile_p95(values: list[float]) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(0.95 * (len(ordered) - 1))))
    return ordered[index]


def main() -> None:
    args = parse_args()
    dataset_path = Path(args.dataset).expanduser().resolve()
    output_path = Path(args.output_path).expanduser().resolve()
    rows = load_jsonl(dataset_path)[: max(1, int(args.max_samples))]
    if not rows:
        raise SystemExit("no evaluation rows available")

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    device = detect_device(torch)
    torch_dtype = torch.float16 if device in {"cuda", "mps"} else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    if tokenizer.pad_token is None and tokenizer.eos_token is not None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
    )
    if args.adapter_path:
        model = PeftModel.from_pretrained(model, str(Path(args.adapter_path).expanduser().resolve()))
    model.to(device)
    model.eval()

    samples: list[dict[str, Any]] = []
    latencies: list[float] = []

    with torch.no_grad():
        for row in rows:
            prompt = build_prompt(row)
            prompt_ids = tokenizer(prompt, return_tensors="pt").input_ids.to(device)
            started = time.perf_counter()
            output_ids = model.generate(
                prompt_ids,
                max_new_tokens=max(32, int(args.max_new_tokens)),
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
            latency_ms = (time.perf_counter() - started) * 1000
            generated_ids = output_ids[0][prompt_ids.shape[-1] :]
            completion = trim_completion(tokenizer.decode(generated_ids, skip_special_tokens=True))
            latencies.append(latency_ms)
            samples.append(evaluate_sample(row, completion, latency_ms))

    coding_pass = sum(1 for item in samples if item["pass"]) / max(1, len(samples))
    policy_adherence = sum(1 for item in samples if item["policyOk"]) / max(1, len(samples))
    tool_use_success = sum(1 for item in samples if item["toolSuccess"]) / max(1, len(samples))
    degenerate_rate = sum(1 for item in samples if item["degenerate"]) / max(1, len(samples))
    keyword_overlap_avg = statistics.fmean(item["keywordOverlap"] for item in samples)
    similarity_avg = statistics.fmean(item["similarity"] for item in samples)
    latency_ms_p95 = percentile_p95(latencies)
    overall_pass = coding_pass >= 0.5 and policy_adherence >= 0.85 and tool_use_success >= 0.5 and degenerate_rate <= 0.2

    payload = {
        "pass": overall_pass,
        "sampleCount": len(samples),
        "failingExampleIds": [item["specId"] for item in samples if not item["pass"]],
        "metrics": {
            "coding_pass_at_1": round(coding_pass, 4),
            "policy_adherence": round(policy_adherence, 4),
            "tool_use_success": round(tool_use_success, 4),
            "degenerate_rate": round(degenerate_rate, 4),
            "keyword_overlap_avg": round(keyword_overlap_avg, 4),
            "similarity_avg": round(similarity_avg, 4),
            "latency_ms_p95": round(latency_ms_p95, 1),
        },
        "metadata": {
            "dataset": str(dataset_path),
            "model": args.model,
            "baseline_model_id": args.baseline_model_id,
            "adapter_path": args.adapter_path,
            "device": device,
        },
        "samples": samples,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)

    print(json.dumps({
        "pass": payload["pass"],
        "sampleCount": payload["sampleCount"],
        "failingExampleIds": payload["failingExampleIds"],
        "metrics": payload["metrics"],
    }))


if __name__ == "__main__":
    main()
