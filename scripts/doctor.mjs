#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const json = args.has("--json");

function checkCommand(command, commandArgs = ["--version"], timeout = 5000) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf-8",
    timeout,
    shell: process.platform === "win32",
  });

  if (result.error) {
    return { ok: false, output: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, output: (result.stderr || result.stdout || `exit ${result.status}`).trim() };
  }
  return { ok: true, output: (result.stdout || result.stderr || "ok").trim() };
}

function checkPythonModules() {
  const probe = [
    "import importlib.util, json",
    "mods = ['torch','transformers','datasets','peft','accelerate']",
    "missing = [m for m in mods if importlib.util.find_spec(m) is None]",
    "print(json.dumps({'missing': missing}))",
  ].join(";");
  const result = checkCommand("python3", ["-c", probe], 12000);
  if (!result.ok) {
    return { ok: false, message: result.output };
  }
  try {
    const parsed = JSON.parse(result.output || "{}");
    const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
    return {
      ok: missing.length === 0,
      message: missing.length === 0 ? "all modules present" : `missing modules: ${missing.join(", ")}`,
    };
  } catch {
    return { ok: false, message: `unexpected probe output: ${result.output}` };
  }
}

async function checkPort(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeout);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function findModelCache() {
  const candidates = [
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--mlx-community--Qwen3.5-4B-4bit"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--mlx-community--Qwen3.5-4B-4bit"),
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--Qwen--Qwen3.5-4B"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--Qwen--Qwen3.5-4B"),
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function run() {
  const checks = [];

  const docker = checkCommand("docker", ["info"]);
  checks.push({
    key: "docker",
    ok: docker.ok,
    severity: "error",
    message: docker.ok ? "Docker daemon is running" : `Docker unavailable: ${docker.output}`,
  });

  const postgresUp = await checkPort("127.0.0.1", 5433);
  checks.push({
    key: "postgres",
    ok: postgresUp,
    severity: "error",
    message: postgresUp ? "Postgres reachable on 127.0.0.1:5433" : "Postgres not reachable on 127.0.0.1:5433",
  });

  const claude = checkCommand("claude", ["--version"]);
  checks.push({
    key: "claude_cli",
    ok: claude.ok,
    severity: "warning",
    message: claude.ok ? "Claude CLI available for teacher distillation." : `Claude CLI unavailable: ${claude.output}`,
  });

  const qwen = checkCommand("qwen", ["--version"]);
  checks.push({
    key: "qwen_cli",
    ok: qwen.ok,
    severity: "warning",
    message: qwen.ok ? "Qwen CLI available (fallback provider)." : `Qwen CLI unavailable: ${qwen.output}`,
  });

  const mlx = checkCommand("python3", ["-m", "mlx_lm", "--help"]);
  checks.push({
    key: "mlx_lm",
    ok: mlx.ok,
    severity: "warning",
    message: mlx.ok ? "MLX-LM available for Apple Silicon serving." : "MLX-LM module not available.",
  });

  const llama = checkCommand("llama-server", ["--version"]);
  checks.push({
    key: "llama_cpp",
    ok: llama.ok,
    severity: "warning",
    message: llama.ok ? "llama.cpp server available." : "llama.cpp server not found.",
  });

  const sglang = checkCommand("python3", ["-m", "sglang.launch_server", "--help"]);
  checks.push({
    key: "sglang",
    ok: sglang.ok,
    severity: "warning",
    message: sglang.ok ? "SGLang launcher available." : "SGLang launcher not available.",
  });

  const vllm = checkCommand("vllm", ["--help"]);
  checks.push({
    key: "vllm",
    ok: vllm.ok,
    severity: "warning",
    message: vllm.ok ? "vLLM command available." : "vLLM command not available.",
  });

  const trtllm = checkCommand("trtllm-serve", ["--help"]);
  checks.push({
    key: "trtllm",
    ok: trtllm.ok,
    severity: "warning",
    message: trtllm.ok ? "TensorRT-LLM serve command available." : "TensorRT-LLM serve command not available.",
  });

  const trainerScriptPath = path.join(process.cwd(), "scripts", "distill", "train_multi_stage.py");
  checks.push({
    key: "distill_trainer_script",
    ok: fs.existsSync(trainerScriptPath),
    severity: "warning",
    message: fs.existsSync(trainerScriptPath)
      ? "Multi-stage distillation trainer script is present."
      : `Multi-stage distillation trainer script missing at ${trainerScriptPath}.`,
  });

  const trainerModules = checkPythonModules();
  checks.push({
    key: "distill_trainer_modules",
    ok: trainerModules.ok,
    severity: "warning",
    message: trainerModules.ok
      ? "Distillation Python modules available (torch, transformers, datasets, peft, accelerate)."
      : `Distillation Python modules not fully available: ${trainerModules.message}`,
  });

  const cachePath = findModelCache();
  checks.push({
    key: "model_cache_qwen",
    ok: Boolean(cachePath),
    severity: "warning",
    message: cachePath ? `Qwen model cache found at ${cachePath}` : "No default Qwen model cache found yet (will download on first load).",
  });

  const runtimeUp = await checkPort("127.0.0.1", 8000);
  checks.push({
    key: "onprem_runtime_8000",
    ok: runtimeUp,
    severity: "warning",
    message: runtimeUp
      ? "Local OpenAI-compatible runtime reachable on 127.0.0.1:8000."
      : "Local OpenAI-compatible runtime not reachable on 127.0.0.1:8000.",
  });

  const hasErrors = checks.some((check) => !check.ok && check.severity === "error");
  const payload = {
    ok: !hasErrors,
    checkedAt: new Date().toISOString(),
    checks,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    const hardBlockers = checks.filter((check) => !check.ok && check.severity === "error");
    const warnings = checks.filter((check) => !check.ok && check.severity !== "error");
    const healthy = checks.filter((check) => check.ok);

    process.stdout.write(`Doctor summary: ${hardBlockers.length} hard blockers, ${warnings.length} warnings, ${healthy.length} healthy checks.\n`);

    if (hardBlockers.length) {
      process.stdout.write("\nHard blockers (must fix):\n");
      for (const check of hardBlockers) {
        process.stdout.write(`[ERR] ${check.key}: ${check.message}\n`);
      }
    }

    if (warnings.length) {
      process.stdout.write("\nWarnings (degraded but non-blocking):\n");
      for (const check of warnings) {
        process.stdout.write(`[WARN] ${check.key}: ${check.message}\n`);
      }
    }

    if (healthy.length) {
      process.stdout.write("\nHealthy:\n");
      for (const check of healthy) {
        process.stdout.write(`[OK] ${check.key}: ${check.message}\n`);
      }
    }
  }

  if (strict && hasErrors) {
    process.exit(1);
  }
}

run().catch((error) => {
  process.stderr.write(`doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
