#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const asJson = args.has("--json");

const apiBaseUrl = process.env.API_BASE_URL || `http://127.0.0.1:${process.env.API_PORT || "8787"}`;
const apiToken = process.env.API_TOKEN || "";
const teacherCommand = process.env.DISTILL_TEACHER_COMMAND || "claude";
const teacherModel = process.env.DISTILL_TEACHER_MODEL || "opus";
const trainerPython = process.env.DISTILL_TRAINER_PYTHON || "python3";
const outputRoot = path.resolve(process.cwd(), ".local/distill");

function checkCommand(command, commandArgs = ["--version"], timeout = 8000) {
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

function checkPythonModules(command) {
  const probe = [
    "import importlib.util, json",
    "mods = ['torch','transformers','datasets','peft','accelerate']",
    "missing = [m for m in mods if importlib.util.find_spec(m) is None]",
    "print(json.dumps({'missing': missing}))",
  ].join(";");
  const result = checkCommand(command, ["-c", probe], 15000);
  if (!result.ok) {
    return { ok: false, missing: ["python_runtime"], output: result.output };
  }
  try {
    const parsed = JSON.parse(result.output || "{}");
    const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
    return { ok: missing.length === 0, missing, output: result.output };
  } catch {
    return { ok: false, missing: ["parse_error"], output: result.output };
  }
}

function checkPort(host, port, timeout = 1200) {
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

function checkOutputRootWritable(root) {
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, `.probe-${Date.now()}.tmp`);
    fs.writeFileSync(probe, "ok", "utf-8");
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

function checkDisk(root) {
  try {
    const stat = fs.statfsSync(root);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const freeGb = Number((freeBytes / (1024 * 1024 * 1024)).toFixed(2));
    return { ok: freeBytes >= 10 * 1024 * 1024 * 1024, freeGb };
  } catch {
    return { ok: false, freeGb: 0 };
  }
}

function findModelCache() {
  const candidates = [
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function checkApiReadiness() {
  try {
    const headers = apiToken ? { "x-local-api-token": apiToken } : {};
    const response = await fetch(`${apiBaseUrl}/api/v2/distill/readiness`, { headers });
    if (!response.ok) {
      return { ok: false, output: `HTTP ${response.status}` };
    }
    const payload = await response.json();
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const checks = [];
  const trainerScriptPath = path.resolve(process.cwd(), "scripts/distill/train_multi_stage.py");

  const apiReadiness = await checkApiReadiness();
  if (apiReadiness.ok) {
    const payload = apiReadiness.payload;
    if (asJson) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Distill readiness (API): ${payload.ready ? "READY" : "NOT READY"} (${payload.blockers} blockers, ${payload.warnings} warnings)\n`
      );
      for (const item of payload.checks) {
        const level = item.ok ? "OK" : item.severity === "error" ? "ERR" : "WARN";
        process.stdout.write(`[${level}] ${item.key}: ${item.message}\n`);
      }
    }
    if (strict && !payload.ready) {
      process.exit(1);
    }
    return;
  }

  checks.push({
    key: "api_readiness_endpoint",
    ok: false,
    severity: "warning",
    message: `API readiness endpoint unavailable (${apiReadiness.output}). Falling back to local checks.`,
  });

  const teacher = checkCommand(teacherCommand, ["--version"]);
  checks.push({
    key: "teacher_cli",
    ok: teacher.ok,
    severity: "error",
    message: teacher.ok ? `${teacherCommand} is available` : `Teacher CLI unavailable: ${teacher.output}`,
  });

  if (teacher.ok) {
    const auth = checkCommand(teacherCommand, ["auth", "status"]);
    checks.push({
      key: "teacher_auth",
      ok: auth.ok,
      severity: "error",
      message: auth.ok ? `Teacher auth valid for alias "${teacherModel}"` : `Teacher auth failed: ${auth.output}`,
    });
  }

  const python = checkCommand(trainerPython, ["--version"]);
  checks.push({
    key: "trainer_python",
    ok: python.ok,
    severity: "error",
    message: python.ok ? `${trainerPython} is available` : `Trainer Python unavailable: ${python.output}`,
  });

  if (python.ok) {
    const modules = checkPythonModules(trainerPython);
    checks.push({
      key: "trainer_python_modules",
      ok: modules.ok,
      severity: "error",
      message: modules.ok
        ? "Trainer modules available (torch, transformers, datasets, peft, accelerate)"
        : `Missing trainer modules: ${modules.missing.join(", ")}`,
    });
  }

  checks.push({
    key: "trainer_script",
    ok: fs.existsSync(trainerScriptPath),
    severity: "error",
    message: fs.existsSync(trainerScriptPath) ? "Multi-stage trainer script found" : `Missing ${trainerScriptPath}`,
  });

  const writable = checkOutputRootWritable(outputRoot);
  checks.push({
    key: "distill_output_root",
    ok: writable.ok,
    severity: "error",
    message: writable.ok ? `Output root writable (${outputRoot})` : `Output root not writable: ${writable.output}`,
  });

  const disk = checkDisk(outputRoot);
  checks.push({
    key: "distill_disk_headroom",
    ok: disk.ok,
    severity: "warning",
    message: disk.ok ? `Disk headroom healthy (${disk.freeGb} GB free)` : `Low disk headroom (${disk.freeGb} GB free)`,
  });

  const runtimePort = await checkPort("127.0.0.1", 8000);
  checks.push({
    key: "local_inference_runtime",
    ok: runtimePort,
    severity: "warning",
    message: runtimePort
      ? "Local inference runtime reachable on 127.0.0.1:8000"
      : "Local inference runtime not reachable on 127.0.0.1:8000",
  });

  const modelCache = findModelCache();
  checks.push({
    key: "qwen_model_cache",
    ok: Boolean(modelCache),
    severity: "warning",
    message: modelCache ? `Qwen model cache found at ${modelCache}` : "Qwen model cache not found yet",
  });

  const blockers = checks.filter((item) => !item.ok && item.severity === "error").length;
  const warnings = checks.filter((item) => !item.ok && item.severity === "warning").length;
  const payload = {
    checkedAt: new Date().toISOString(),
    ready: blockers === 0,
    blockers,
    warnings,
    checks,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`Distill readiness (local): ${payload.ready ? "READY" : "NOT READY"} (${blockers} blockers, ${warnings} warnings)\n`);
    for (const item of checks) {
      const level = item.ok ? "OK" : item.severity === "error" ? "ERR" : "WARN";
      process.stdout.write(`[${level}] ${item.key}: ${item.message}\n`);
    }
  }

  if (strict && blockers > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`distill doctor failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
