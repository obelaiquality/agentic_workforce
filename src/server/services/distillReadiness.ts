import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawnSync } from "node:child_process";

export interface DistillReadinessCheck {
  key: string;
  ok: boolean;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface DistillReadinessResult {
  checkedAt: string;
  ready: boolean;
  blockers: number;
  warnings: number;
  checks: DistillReadinessCheck[];
}

interface DistillReadinessInput {
  teacherCommand: string;
  teacherModel: string;
  trainerPythonCommand: string;
  outputRoot: string;
}

function checkCommand(command: string, args: string[] = ["--version"], timeoutMs = 8000) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    timeout: timeoutMs,
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

function checkPythonModules(command: string) {
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
    const parsed = JSON.parse(result.output || "{}") as { missing?: string[] };
    const missing = Array.isArray(parsed.missing) ? parsed.missing : [];
    return { ok: missing.length === 0, missing, output: result.output };
  } catch {
    return { ok: false, missing: ["parse_error"], output: result.output };
  }
}

async function checkPort(host: string, port: number, timeout = 1200) {
  return new Promise<boolean>((resolve) => {
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

function checkOutputRootWritable(outputRoot: string) {
  try {
    fs.mkdirSync(outputRoot, { recursive: true });
    const probe = path.join(outputRoot, `.probe-${Date.now()}.tmp`);
    fs.writeFileSync(probe, "ok", "utf-8");
    fs.unlinkSync(probe);
    return { ok: true, output: outputRoot };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

function diskHeadroom(outputRoot: string) {
  try {
    const stat = fs.statfsSync(outputRoot);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    return {
      ok: freeBytes >= 10 * 1024 * 1024 * 1024,
      freeBytes,
      freeGb: Number((freeBytes / (1024 * 1024 * 1024)).toFixed(2)),
    };
  } catch {
    return { ok: false, freeBytes: 0, freeGb: 0 };
  }
}

function findQwenModelCache() {
  const candidates = [
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--mlx-community--Qwen3.5-4B-4bit"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--mlx-community--Qwen3.5-4B-4bit"),
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--Qwen--Qwen3.5-4B"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--Qwen--Qwen3.5-4B"),
    path.join(os.homedir(), ".cache", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
    path.join(os.homedir(), "Library", "Caches", "huggingface", "hub", "models--Qwen--Qwen3.5-0.8B"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function runDistillReadinessChecks(input: DistillReadinessInput): Promise<DistillReadinessResult> {
  const checks: DistillReadinessCheck[] = [];
  const trainerScript = path.resolve(process.cwd(), "scripts/distill/train_multi_stage.py");

  const teacherCommand = checkCommand(input.teacherCommand, ["--version"]);
  checks.push({
    key: "teacher_cli",
    ok: teacherCommand.ok,
    severity: "error",
    message: teacherCommand.ok
      ? `${input.teacherCommand} CLI is available`
      : `${input.teacherCommand} CLI unavailable: ${teacherCommand.output}`,
  });

  if (teacherCommand.ok) {
    const auth = checkCommand(input.teacherCommand, ["auth", "status"]);
    checks.push({
      key: "teacher_auth",
      ok: auth.ok,
      severity: "error",
      message: auth.ok ? `Teacher auth is valid for model alias "${input.teacherModel}"` : `Teacher auth check failed: ${auth.output}`,
    });
  }

  const python = checkCommand(input.trainerPythonCommand, ["--version"]);
  checks.push({
    key: "trainer_python",
    ok: python.ok,
    severity: "error",
    message: python.ok ? `${input.trainerPythonCommand} is available` : `Trainer Python unavailable: ${python.output}`,
  });

  if (python.ok) {
    const modules = checkPythonModules(input.trainerPythonCommand);
    checks.push({
      key: "trainer_python_modules",
      ok: modules.ok,
      severity: "error",
      message: modules.ok
        ? "Trainer modules available (torch, transformers, datasets, peft, accelerate)"
        : `Missing trainer modules: ${modules.missing.join(", ")}`,
      details: { missing: modules.missing },
    });
  }

  checks.push({
    key: "trainer_script",
    ok: fs.existsSync(trainerScript),
    severity: "error",
    message: fs.existsSync(trainerScript)
      ? "Multi-stage trainer script found"
      : `Missing trainer script: ${trainerScript}`,
  });

  const writable = checkOutputRootWritable(input.outputRoot);
  checks.push({
    key: "distill_output_root",
    ok: writable.ok,
    severity: "error",
    message: writable.ok ? `Distill output root writable (${input.outputRoot})` : `Distill output root not writable: ${writable.output}`,
  });

  if (writable.ok) {
    const headroom = diskHeadroom(input.outputRoot);
    checks.push({
      key: "distill_disk_headroom",
      ok: headroom.ok,
      severity: "warning",
      message: headroom.ok
        ? `Disk headroom is healthy (${headroom.freeGb} GB free)`
        : `Low disk headroom (${headroom.freeGb} GB free). Minimum recommended is 10 GB.`,
      details: { freeGb: headroom.freeGb },
    });
  }

  const inferencePort = await checkPort("127.0.0.1", 8000);
  checks.push({
    key: "local_inference_runtime",
    ok: inferencePort,
    severity: "warning",
    message: inferencePort
      ? "Local inference runtime is reachable on 127.0.0.1:8000"
      : "Local inference runtime is not reachable on 127.0.0.1:8000",
  });

  const cachePath = findQwenModelCache();
  checks.push({
    key: "qwen_model_cache",
    ok: Boolean(cachePath),
    severity: "warning",
    message: cachePath ? `Qwen model cache found at ${cachePath}` : "No default Qwen model cache found (first run will download)",
  });

  const blockers = checks.filter((item) => !item.ok && item.severity === "error").length;
  const warnings = checks.filter((item) => !item.ok && item.severity === "warning").length;
  return {
    checkedAt: new Date().toISOString(),
    ready: blockers === 0,
    blockers,
    warnings,
    checks,
  };
}
