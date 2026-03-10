#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time


def launch_mlx_server(model: str, host: str, port: int, temperature: float, max_tokens: int) -> None:
    cmd = [
        sys.executable,
        "-m",
        "mlx_lm",
        "server",
        "--model",
        model,
        "--host",
        host,
        "--port",
        str(port),
        "--temp",
        str(temperature),
        "--max-tokens",
        str(max_tokens),
    ]
    os.execvp(cmd[0], cmd)


def build_transformers_app(model_id: str, adapter_path: str | None = None):
    import torch
    from fastapi import Body, FastAPI, HTTPException
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    def resolve_device() -> str:
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def clamp(value: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, value))

    def build_instruction_prompt(messages: list[dict[str, str]]) -> str:
        latest_user = next((item["content"] for item in reversed(messages) if item["role"] == "user"), "")
        instruction = latest_user or messages[-1]["content"] or "Respond to the request safely and concisely."
        context_lines: list[str] = []
        system_messages = [item["content"] for item in messages if item["role"] == "system" and item["content"]]
        if system_messages:
            context_lines.append("System guidance:")
            context_lines.extend(system_messages)
        history = messages[:-1] if messages and messages[-1]["content"] == instruction else messages
        if history:
            context_lines.append("Conversation context:")
            for item in history:
                if not item["content"]:
                    continue
                context_lines.append(f"{item['role'].upper()}: {item['content']}")
        input_text = "\n".join(context_lines).strip() or "No additional context."
        return (
            "### Instruction\n"
            f"{instruction}\n\n"
            "### Input\n"
            f"{input_text}\n\n"
            "### Response\n"
        )

    device = resolve_device()
    torch_dtype = torch.float16 if device in {"cuda", "mps"} else torch.float32

    print(f"[local-qwen] loading model={model_id} device={device} dtype={torch_dtype}")
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        dtype=torch_dtype,
        low_cpu_mem_usage=True,
    )

    adapter_loaded = False
    if adapter_path:
        print(f"[local-qwen] loading adapter={adapter_path}")
        model = PeftModel.from_pretrained(model, adapter_path)
        adapter_loaded = True

    model.to(device)
    model.eval()
    print("[local-qwen] model loaded")

    inference_lock = asyncio.Lock()
    app = FastAPI(title="Local Qwen OpenAI-Compatible Server")

    @app.get("/health")
    async def health():
        return {
            "ok": True,
            "model": model_id,
            "device": device,
            "adapter_loaded": adapter_loaded,
            "adapter_path": adapter_path,
        }

    @app.get("/v1/models")
    async def list_models():
        return {
            "object": "list",
            "data": [
                {
                    "id": model_id,
                    "object": "model",
                    "owned_by": "local",
                }
            ],
        }

    @app.post("/v1/chat/completions")
    async def chat_completions(payload: dict = Body(...)):
        stream = bool(payload.get("stream", False))
        if stream:
            raise HTTPException(status_code=400, detail="stream=true is not supported by local_qwen_openai_server")

        raw_messages = payload.get("messages")
        if not isinstance(raw_messages, list) or not raw_messages:
            raise HTTPException(status_code=400, detail="messages[] is required")

        messages: list[dict[str, str]] = []
        for item in raw_messages:
            if not isinstance(item, dict):
                raise HTTPException(status_code=400, detail="message items must be objects")
            role = str(item.get("role", "user")).strip().lower()
            if role not in {"system", "user", "assistant"}:
                role = "user"
            content = str(item.get("content", "")).strip()
            messages.append({"role": role, "content": content})

        temperature_input = payload.get("temperature", 0.2)
        max_tokens_input = payload.get("max_tokens", 512)
        request_model = payload.get("model")
        temperature_raw = float(temperature_input) if isinstance(temperature_input, (int, float)) else 0.2
        max_tokens_raw = int(max_tokens_input) if isinstance(max_tokens_input, (int, float)) else 512

        try:
            if adapter_loaded:
                prompt_text = build_instruction_prompt(messages)
            else:
                prompt_text = tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
            prompt_ids = tokenizer(prompt_text, return_tensors="pt").input_ids
        except Exception:
            prompt_text = "\n\n".join(f"{m['role'].upper()}: {m['content']}" for m in messages) + "\n\nASSISTANT:"
            prompt_ids = tokenizer(prompt_text, return_tensors="pt").input_ids

        prompt_ids = prompt_ids.to(device)
        temperature = clamp(temperature_raw, 0.0, 1.5)
        do_sample = temperature > 0
        max_new_tokens = int(clamp(max_tokens_raw, 16, 2048))

        async with inference_lock:
            with torch.no_grad():
                try:
                    output_ids = model.generate(
                        prompt_ids,
                        max_new_tokens=max_new_tokens,
                        do_sample=do_sample,
                        temperature=temperature if do_sample else None,
                        top_p=0.95 if do_sample else None,
                        pad_token_id=tokenizer.eos_token_id,
                    )
                except RuntimeError as error:
                    error_message = str(error).lower()
                    if "probability tensor contains either `inf`, `nan` or element < 0" not in error_message:
                        raise
                    print("[local-qwen] sampling became invalid; retrying with greedy decoding", file=sys.stderr)
                    output_ids = model.generate(
                        prompt_ids,
                        max_new_tokens=max_new_tokens,
                        do_sample=False,
                        pad_token_id=tokenizer.eos_token_id,
                    )

        generated_ids = output_ids[0][prompt_ids.shape[-1] :]
        completion_text = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
        for marker in ("\n### Instruction", "\n### Input", "\n### Response"):
            if marker in completion_text:
                completion_text = completion_text.split(marker, 1)[0].strip()

        usage = {
            "prompt_tokens": int(prompt_ids.shape[-1]),
            "completion_tokens": int(generated_ids.shape[-1]),
            "total_tokens": int(prompt_ids.shape[-1] + generated_ids.shape[-1]),
        }

        now = int(time.time())
        response_model = request_model if isinstance(request_model, str) and request_model.strip() else model_id

        return {
            "id": f"chatcmpl-local-{now}",
            "object": "chat.completion",
            "created": now,
            "model": response_model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": completion_text},
                    "finish_reason": "stop",
                }
            ],
            "usage": usage,
        }

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Local OpenAI-compatible server for Qwen models")
    parser.add_argument("--backend", choices=["mlx-lm", "transformers"], default="mlx-lm")
    parser.add_argument("--model", default=None)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--temperature", type=float, default=0.15)
    parser.add_argument("--max-tokens", type=int, default=1600)
    parser.add_argument("--adapter-path", default=None)
    args = parser.parse_args()

    model = args.model
    if not model:
        model = "mlx-community/Qwen3.5-4B-4bit" if args.backend == "mlx-lm" else "Qwen/Qwen3.5-4B"

    if args.backend == "mlx-lm":
        launch_mlx_server(model, args.host, args.port, args.temperature, args.max_tokens)

    import uvicorn

    app = build_transformers_app(model, args.adapter_path)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
