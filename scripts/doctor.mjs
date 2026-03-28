#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const args = new Set(argv);
const strict = args.has("--strict");
const json = args.has("--json");
const requestedMode = getArgValue("--mode") || "core";
const validModes = new Set(["core", "local-runtime", "distillation", "all"]);

if (!validModes.has(requestedMode)) {
  process.stderr.write(`Unknown doctor mode: ${requestedMode}\n`);
  process.exit(1);
}

function getArgValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    process.stderr.write(`Missing value for ${flag}\n`);
    process.exit(1);
  }
  return value;
}

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
    return {
      ok: false,
      output: (result.stderr || result.stdout || `exit ${result.status}`).trim(),
    };
  }

  return { ok: true, output: (result.stdout || result.stderr || "ok").trim() };
}

function parseMajorVersion(rawVersion) {
  const match = rawVersion.match(/v?(\d+)/);
  return match ? Number(match[1]) : NaN;
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

function buildCheck({ key, ok, severity, message }) {
  return { key, ok, severity, message };
}

async function buildCoreChecks() {
  const node = checkCommand("node", ["--version"]);
  const npm = checkCommand("npm", ["--version"]);
  const git = checkCommand("git", ["--version"]);
  const docker = checkCommand("docker", ["info"]);
  const postgresUp = await checkPort("127.0.0.1", 5433);
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());

  const nodeMajor = node.ok ? parseMajorVersion(node.output) : NaN;
  const checks = [
    buildCheck({
      key: "node",
      ok: node.ok && Number.isFinite(nodeMajor) && nodeMajor >= 20,
      severity: "error",
      message:
        node.ok && Number.isFinite(nodeMajor)
          ? `Node ${node.output.trim()} detected${nodeMajor >= 20 ? "" : " but Node 20+ is required"}`
          : `Node unavailable: ${node.output}`,
    }),
    buildCheck({
      key: "npm",
      ok: npm.ok,
      severity: "error",
      message: npm.ok ? `npm ${npm.output.trim()} detected` : `npm unavailable: ${npm.output}`,
    }),
    buildCheck({
      key: "git",
      ok: git.ok,
      severity: "error",
      message: git.ok ? git.output.trim() : `Git unavailable: ${git.output}`,
    }),
  ];

  if (postgresUp) {
    checks.push(
      buildCheck({
        key: "postgres",
        ok: true,
        severity: "error",
        message: "Postgres reachable on 127.0.0.1:5433",
      })
    );
  } else if (docker.ok) {
    checks.push(
      buildCheck({
        key: "postgres_bootstrap",
        ok: true,
        severity: "warning",
        message: "Postgres is not running, but Docker is healthy. Run `npm run db:up` to start the default database.",
      })
    );
  } else {
    checks.push(
      buildCheck({
        key: "postgres_bootstrap",
        ok: false,
        severity: "error",
        message: "Postgres is not reachable on 127.0.0.1:5433 and Docker is unavailable for the default bootstrap path.",
      })
    );
  }

  checks.push(
    buildCheck({
      key: "openai_key",
      ok: hasOpenAiKey,
      severity: "warning",
      message: hasOpenAiKey
        ? "OPENAI_API_KEY is set for the recommended first-success path."
        : "OPENAI_API_KEY is not set. Source install still works, but the default first-success flow will need it or a configured local runtime.",
    })
  );

  return {
    name: "core",
    title: "Core Desktop",
    checks,
  };
}

async function buildLocalRuntimeChecks() {
  const qwen = checkCommand("qwen", ["--version"]);
  const mlx = checkCommand("python3", ["-m", "mlx_lm", "--help"]);
  const llama = checkCommand("llama-server", ["--version"]);
  const sglang = checkCommand("python3", ["-m", "sglang.launch_server", "--help"]);
  const vllm = checkCommand("vllm", ["--help"]);
  const trtllm = checkCommand("trtllm-serve", ["--help"]);
  const runtimeUp = await checkPort("127.0.0.1", 8000);
  const cachePath = findModelCache();

  return {
    name: "local-runtime",
    title: "Local Runtime",
    checks: [
      buildCheck({
        key: "runtime_port_8000",
        ok: runtimeUp,
        severity: "warning",
        message: runtimeUp
          ? "Local OpenAI-compatible runtime reachable on 127.0.0.1:8000."
          : "No local runtime is currently reachable on 127.0.0.1:8000.",
      }),
      buildCheck({
        key: "qwen_cli",
        ok: qwen.ok,
        severity: "warning",
        message: qwen.ok ? "Qwen CLI available." : `Qwen CLI unavailable: ${qwen.output}`,
      }),
      buildCheck({
        key: "mlx_lm",
        ok: mlx.ok,
        severity: "warning",
        message: mlx.ok ? "MLX-LM available." : "MLX-LM module not available.",
      }),
      buildCheck({
        key: "llama_cpp",
        ok: llama.ok,
        severity: "warning",
        message: llama.ok ? "llama.cpp server available." : "llama.cpp server not found.",
      }),
      buildCheck({
        key: "sglang",
        ok: sglang.ok,
        severity: "warning",
        message: sglang.ok ? "SGLang launcher available." : "SGLang launcher not available.",
      }),
      buildCheck({
        key: "vllm",
        ok: vllm.ok,
        severity: "warning",
        message: vllm.ok ? "vLLM command available." : "vLLM command not available.",
      }),
      buildCheck({
        key: "trtllm",
        ok: trtllm.ok,
        severity: "warning",
        message: trtllm.ok ? "TensorRT-LLM serve command available." : "TensorRT-LLM serve command not available.",
      }),
      buildCheck({
        key: "model_cache_qwen",
        ok: Boolean(cachePath),
        severity: "warning",
        message: cachePath ? `Qwen model cache found at ${cachePath}` : "No default Qwen model cache found yet.",
      }),
    ],
  };
}

async function buildDistillationChecks() {
  const claude = checkCommand("claude", ["--version"]);
  const trainerScriptPath = path.join(process.cwd(), "scripts", "distill", "train_multi_stage.py");
  const trainerModules = checkPythonModules();

  return {
    name: "distillation",
    title: "Distillation",
    checks: [
      buildCheck({
        key: "claude_cli",
        ok: claude.ok,
        severity: "warning",
        message: claude.ok ? "Claude CLI available." : `Claude CLI unavailable: ${claude.output}`,
      }),
      buildCheck({
        key: "distill_trainer_script",
        ok: fs.existsSync(trainerScriptPath),
        severity: "error",
        message: fs.existsSync(trainerScriptPath)
          ? "Multi-stage trainer script is present."
          : `Multi-stage trainer script missing at ${trainerScriptPath}.`,
      }),
      buildCheck({
        key: "distill_trainer_modules",
        ok: trainerModules.ok,
        severity: "error",
        message: trainerModules.ok
          ? "Distillation Python modules are available."
          : `Distillation Python modules not fully available: ${trainerModules.message}`,
      }),
    ],
  };
}

async function gatherGroups(mode) {
  if (mode === "core") {
    return [await buildCoreChecks()];
  }
  if (mode === "local-runtime") {
    return [await buildCoreChecks(), await buildLocalRuntimeChecks()];
  }
  if (mode === "distillation") {
    return [await buildCoreChecks(), await buildDistillationChecks()];
  }
  return [await buildCoreChecks(), await buildLocalRuntimeChecks(), await buildDistillationChecks()];
}

function summarizeGroup(group) {
  const errors = group.checks.filter((check) => !check.ok && check.severity === "error");
  const warnings = group.checks.filter((check) => !check.ok && check.severity !== "error");
  const healthy = group.checks.filter((check) => check.ok);
  return {
    name: group.name,
    title: group.title,
    checks: group.checks,
    counts: {
      errors: errors.length,
      warnings: warnings.length,
      healthy: healthy.length,
    },
  };
}

function printHuman(summary) {
  const totalErrors = summary.groups.reduce((count, group) => count + group.counts.errors, 0);
  const totalWarnings = summary.groups.reduce((count, group) => count + group.counts.warnings, 0);
  const totalHealthy = summary.groups.reduce((count, group) => count + group.counts.healthy, 0);

  process.stdout.write(
    `Doctor mode: ${summary.mode}. ${totalErrors} hard blocker${totalErrors === 1 ? "" : "s"}, ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}, ${totalHealthy} healthy check${totalHealthy === 1 ? "" : "s"}.\n`
  );

  for (const group of summary.groups) {
    process.stdout.write(`\n${group.title}:\n`);
    for (const check of group.checks) {
      const label = check.ok ? "OK" : check.severity === "error" ? "ERR" : "WARN";
      process.stdout.write(`[${label}] ${check.key}: ${check.message}\n`);
    }
  }

  if (summary.mode === "core") {
    process.stdout.write(
      "\nUse `npm run doctor -- --mode local-runtime` for local inference tooling or `npm run doctor -- --mode distillation` for training prerequisites.\n"
    );
  }
}

async function main() {
  const groups = await gatherGroups(requestedMode);
  const summaries = groups.map(summarizeGroup);
  const hasErrors = summaries.some((group) => group.checks.some((check) => !check.ok && check.severity === "error"));
  const payload = {
    ok: !hasErrors,
    checkedAt: new Date().toISOString(),
    mode: requestedMode,
    groups: summaries,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    printHuman(payload);
  }

  if (strict && hasErrors) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
