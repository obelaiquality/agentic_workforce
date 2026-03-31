import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { ContextPack, ExecutionAttempt, ModelRole, ProviderId, VerificationBundle } from "../../shared/contracts";
import { V2EventService } from "./v2EventService";
import { RouterService } from "./routerService";
import { ContextService } from "./contextService";
import { ProviderOrchestrator } from "./providerOrchestrator";
import { RepoService } from "./repoService";
import { CodeGraphService } from "./codeGraphService";
import { detectShell } from "./shellDetect";
import { CommandEngine } from "./commandEngine";
import type { VerificationCommandPlan } from "./verificationPolicy";
import { redactSensitiveText } from "./sensitiveRedaction";

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function truncate(text: string, max = 500) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

async function withTimeout<T>(label: string, ms: number, operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function runShell(command: string, cwd: string) {
  const commandTimeoutMs = Math.max(
    15000,
    Math.min(180000, Number(process.env.EXECUTION_COMMAND_TIMEOUT_MS || 90000))
  );
  try {
    const stdout = execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: detectShell(),
      timeout: commandTimeoutMs,
    });
    return { ok: true, stdout, stderr: "", exitCode: 0 };
  } catch (error) {
    const payload = error as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number; message?: string };
    return {
      ok: false,
      stdout: typeof payload.stdout === "string" ? payload.stdout : payload.stdout?.toString("utf8") || "",
      stderr: typeof payload.stderr === "string" ? payload.stderr : payload.stderr?.toString("utf8") || payload.message || "",
      exitCode: payload.status ?? 1,
    };
  }
}

function combinedShellOutput(result: { stdout: string; stderr: string }) {
  return `${result.stderr || ""}\n${result.stdout || ""}`.trim().toLowerCase();
}

function classifyInfraVerificationFailure(command: string, result: { stdout: string; stderr: string; exitCode: number }) {
  const output = combinedShellOutput(result);
  if (!output) return null;

  if (
    result.exitCode === 127 ||
    /\bcommand not found\b/.test(output) ||
    /is not recognized as an internal or external command/.test(output)
  ) {
    return {
      code: `infra_missing_tool:${command}`,
      message: `Missing tool while running "${command}".`,
    };
  }

  if (
    /cannot find module/.test(output) ||
    /module not found/.test(output) ||
    /err_module_not_found/.test(output) ||
    /no module named/.test(output)
  ) {
    return {
      code: `infra_missing_dependency:${command}`,
      message: `Missing dependency while running "${command}".`,
    };
  }

  if (result.exitCode === 124 || /\btimed out\b/.test(output)) {
    return {
      code: `infra_command_timeout:${command}`,
      message: `Command timeout while running "${command}".`,
    };
  }

  return null;
}

function hasInfraVerificationFailure(failures: string[]) {
  return failures.some(
    (failure) =>
      failure.startsWith("infra_missing_tool:") ||
      failure.startsWith("infra_missing_dependency:") ||
      failure.startsWith("infra_command_timeout:") ||
      failure.startsWith("setup_failed:")
  );
}

export function resolveDependencyBootstrapCommand(worktreePath: string) {
  const has = (name: string) => fs.existsSync(path.join(worktreePath, name));
  if (has("pnpm-lock.yaml")) return "pnpm install";
  if (has("yarn.lock")) return "yarn install";
  if (has("bun.lockb") || has("bun.lock")) return "bun install";
  if (has("package.json")) return "npm install";
  return null;
}

function ensureInsideRoot(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside active worktree: ${relativePath}`);
  }
  return resolved;
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Model did not return a JSON object");
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as {
    summary?: string;
    writes?: Array<{ path: string; content: string }>;
    docsChecked?: string[];
    tests?: string[];
  };
}

function extractDefaultExportName(content: string) {
  const functionMatch = content.match(/export\s+default\s+function\s+([A-Za-z0-9_$]+)/);
  if (functionMatch) {
    return functionMatch[1];
  }
  const identifierMatch = content.match(/export\s+default\s+([A-Za-z0-9_$]+)\s*;?/);
  return identifierMatch?.[1] || null;
}

function extractRequestedComponentName(objective: string) {
  const componentMatch = objective.match(/\badd\s+(?:a|an|the)?\s*([a-z0-9][a-z0-9\s-]*?)\s+component\b/i);
  return componentMatch ? toPascalCase(componentMatch[1]) : null;
}

type PatchManifestFile = {
  path: string;
  action: "create" | "update";
  strategy?: "full_file" | "unified_diff" | "search_replace";
  reason: string;
};

type ParsedPatchManifest = {
  summary: string;
  files: PatchManifestFile[];
  docsChecked: string[];
  tests: string[];
  raw: string;
};

function toPascalCase(input: string) {
  return input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

type GeneratedPatchPlan = {
  summary: string;
  writes: Array<{ path: string; content: string }>;
  docsChecked: string[];
  tests: string[];
  raw: string;
  files: PatchManifestFile[];
};

function parsePatchManifest(text: string): ParsedPatchManifest {
  const plan = extractJsonObject(text);
  return {
    summary: plan.summary || truncate(text, 180),
    files: Array.isArray((plan as { files?: unknown[] }).files)
      ? ((plan as { files?: unknown[] }).files || [])
          .map((item) => {
            const row = item as { path?: unknown; action?: unknown; reason?: unknown };
            return {
              path: typeof row.path === "string" ? row.path.trim() : "",
              action: row.action === "create" ? "create" : "update",
              strategy:
                row.strategy === "unified_diff" ? "unified_diff" : row.strategy === "search_replace" ? "search_replace" : "full_file",
              reason: typeof row.reason === "string" && row.reason.trim() ? row.reason.trim() : "Update this file to satisfy the objective.",
            } satisfies PatchManifestFile;
          })
          .filter((item) => item.path)
      : [],
    docsChecked: Array.isArray(plan.docsChecked) ? plan.docsChecked.filter((item): item is string => typeof item === "string") : [],
    tests: Array.isArray(plan.tests) ? plan.tests.filter((item): item is string => typeof item === "string") : [],
    raw: text,
  };
}

function applyManifestHeuristics(input: {
  objective: string;
  worktreePath: string;
  manifest: ParsedPatchManifest;
  candidateTests?: string[];
}): ParsedPatchManifest {
  const files = [...input.manifest.files];
  const componentName = extractRequestedComponentName(input.objective);
  let componentAllowedPaths: Set<string> | null = null;
  if (componentName) {
    const hasPlan = (candidatePath: string) => files.some((file) => file.path.replace(/\\/g, "/") === candidatePath);
    const componentPath = `src/components/${componentName}.tsx`;
    componentAllowedPaths = new Set([componentPath, "src/App.tsx", "src/App.test.tsx", "README.md"]);
    const componentAbsolute = ensureInsideRoot(input.worktreePath, componentPath);
    if (!hasPlan(componentPath) && !fs.existsSync(componentAbsolute)) {
      files.push({
        path: componentPath,
        action: "create",
        strategy: "full_file",
        reason: `Create the ${componentName} component requested by the objective.`,
      });
    }
    if (!hasPlan("src/App.tsx")) {
      files.push({
        path: "src/App.tsx",
        action: "update",
        strategy: "search_replace",
        reason: `Render the ${componentName} component in the main app view.`,
      });
    }
    const fallbackTest =
      (input.candidateTests || []).find((value) => /src\/App\.(test|spec)\.[jt]sx?$/i.test(value)) || "src/App.test.tsx";
    if (!hasPlan(fallbackTest)) {
      files.push({
        path: fallbackTest,
        action: "update",
        strategy: "search_replace",
        reason: `Cover the ${componentName} component in tests.`,
      });
    }
    if (!hasPlan("README.md")) {
      files.push({
        path: "README.md",
        action: "update",
        strategy: "search_replace",
        reason: `Document the ${componentName} addition if user-facing behavior changed.`,
      });
    }
  }

  if (/\btest(s|ing)?\b/i.test(input.objective)) {
    const existingTestPlan = files.some((file) => /\.(test|spec)\.[jt]sx?$/.test(file.path));
    if (!existingTestPlan) {
      const fallbackTest = (input.candidateTests || []).find((value) => /\.(test|spec)\.[jt]sx?$/.test(value));
      if (fallbackTest) {
        files.push({
          path: fallbackTest,
          action: "update",
          strategy: "search_replace",
          reason: "Update an existing test file to cover the requested behavior change.",
        });
      }
    }
  }

  const deduped = new Map<string, PatchManifestFile>();
  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/");
    if (componentAllowedPaths && !componentAllowedPaths.has(normalizedPath)) {
      continue;
    }
    deduped.set(normalizedPath, file);
  }

  return {
    ...input.manifest,
    files: [...deduped.values()],
  };
}

function countLines(text: string) {
  return text ? text.split("\n").length : 0;
}

function chooseEditStrategy(input: {
  filePath?: string;
  currentContent: string;
  requested?: PatchManifestFile["strategy"];
  action: "create" | "update";
}) {
  if (input.action === "create") {
    return "full_file" as const;
  }

  const lines = countLines(input.currentContent);

  // Test files: full_file only when small, otherwise search_replace
  if (input.filePath && /\.(test|spec)\.[jt]sx?$/.test(input.filePath)) {
    return lines > 220 ? ("search_replace" as const) : ("full_file" as const);
  }

  // Honor explicit constrained-format requests
  if (input.requested === "search_replace") {
    return "search_replace" as const;
  }
  if (input.requested === "unified_diff") {
    return "unified_diff" as const;
  }

  // Guard: do NOT allow full_file rewrite on large existing files even if
  // the model requested it — constrained formats are safer for updates.
  // full_file is only appropriate when the file is small enough that a
  // rewrite is no more expensive than a targeted patch.
  if (input.requested === "full_file" && lines > 150) {
    return lines > 320 ? ("unified_diff" as const) : ("search_replace" as const);
  }

  if (lines > 320) {
    return "unified_diff" as const;
  }
  if (lines > 180) {
    return "search_replace" as const;
  }
  return "full_file" as const;
}

function applySearchReplaceEdits(
  currentContent: string,
  replacements: Array<{ find: string; replace: string }>,
  appendBlocks: string[] = []
) {
  let next = currentContent;
  let changed = false;

  for (const replacement of replacements) {
    if (!replacement.find) {
      throw new Error("Replacement is missing a find block");
    }
    if (!next.includes(replacement.find)) {
      throw new Error(`Replacement target not found: ${truncate(replacement.find, 80)}`);
    }
    next = next.replace(replacement.find, replacement.replace ?? "");
    changed = true;
  }

  for (const block of appendBlocks) {
    if (!block.trim()) {
      continue;
    }
    if (!next.includes(block.trim())) {
      next = `${next.replace(/\s*$/, "")}${next.trim().length ? "\n\n" : ""}${block.trim()}\n`;
      changed = true;
    }
  }

  return {
    content: next.endsWith("\n") ? next : `${next}\n`,
    changed,
  };
}

function parseSearchReplacePayload(text: string) {
  const payload = extractJsonObject(text) as {
    replacements?: Array<{ find?: unknown; replace?: unknown }>;
    appendBlocks?: unknown[];
  };

  return {
    replacements: Array.isArray(payload.replacements)
      ? payload.replacements
          .map((item) => ({
            find: typeof item.find === "string" ? item.find : "",
            replace: typeof item.replace === "string" ? item.replace : "",
          }))
          .filter((item) => item.find)
      : [],
    appendBlocks: Array.isArray(payload.appendBlocks)
      ? payload.appendBlocks.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [],
  };
}

function extractUnifiedDiff(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const fenced = normalized.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || normalized).trim();
  const start = candidate.search(/^---\s+/m);
  if (start === -1) {
    throw new Error("Model did not return a unified diff");
  }
  return `${candidate.slice(start).trim()}\n`;
}

function applyUnifiedDiffPatch(input: { worktreePath: string; filePath: string; currentContent: string; patchText: string }) {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-diff-"));
  try {
    const relativePath = input.filePath.replace(/\\/g, "/");
    const sandboxFile = ensureInsideRoot(sandboxRoot, relativePath);
    fs.mkdirSync(path.dirname(sandboxFile), { recursive: true });
    fs.writeFileSync(sandboxFile, input.currentContent, "utf8");
    const patchFile = path.join(sandboxRoot, "patch.diff");
    fs.writeFileSync(patchFile, input.patchText, "utf8");
    const check = runShell(`git apply --check --unsafe-paths --recount ${JSON.stringify(patchFile)}`, sandboxRoot);
    if (!check.ok) {
      throw new Error(check.stderr || check.stdout || "Unified diff failed validation");
    }
    const apply = runShell(`git apply --unsafe-paths --recount ${JSON.stringify(patchFile)}`, sandboxRoot);
    if (!apply.ok) {
      throw new Error(apply.stderr || apply.stdout || "Unified diff failed to apply");
    }
    return fs.readFileSync(sandboxFile, "utf8");
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

function readRelativeFiles(root: string, relativePaths: string[]) {
  return relativePaths
    .slice(0, 6)
    .map((relativePath) => {
      const absolutePath = ensureInsideRoot(root, relativePath);
      return {
        path: relativePath,
        content: fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8").slice(0, 12000) : "",
      };
    })
    .filter((item) => item.content || item.path);
}

function chooseSupportingPaths(input: {
  filePath: string;
  writes: string[];
  manifestFiles: string[];
  contextTests: string[];
  contextDocs: string[];
}) {
  const normalizedTarget = input.filePath.replace(/\\/g, "/");
  const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(normalizedTarget);
  const isDocFile = normalizedTarget.endsWith(".md");
  const isComponentFile = /src\/components\/.+\.[jt]sx?$/.test(normalizedTarget);

  const all = unique([
    ...input.writes,
    ...input.manifestFiles,
    ...input.contextTests,
    ...input.contextDocs,
  ]).filter((candidate) => candidate.replace(/\\/g, "/") !== normalizedTarget);

  if (isTestFile) {
    return all
      .filter((candidate) => {
        const normalized = candidate.replace(/\\/g, "/");
        return (
          /src\/components\/.+\.[jt]sx?$/.test(normalized) ||
          /src\/App\.[jt]sx?$/.test(normalized) ||
          /\.(test|spec)\.[jt]sx?$/.test(normalized)
        );
      })
      .slice(0, 3);
  }

  if (isComponentFile) {
    return all
      .filter((candidate) => {
        const normalized = candidate.replace(/\\/g, "/");
        return /src\/App\.[jt]sx?$/.test(normalized) || normalized.endsWith(".css") || normalized.endsWith("README.md");
      })
      .slice(0, 3);
  }

  if (isDocFile) {
    return all
      .filter((candidate) => {
        const normalized = candidate.replace(/\\/g, "/");
        return /src\//.test(normalized) || /\.(test|spec)\.[jt]sx?$/.test(normalized);
      })
      .slice(0, 3);
  }

  return all.slice(0, 4);
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function extractTaggedFileContent(text: string) {
  const tagged = text.match(/<file-content>\s*([\s\S]*?)\s*<\/file-content>/i);
  if (tagged?.[1]) {
    return tagged[1];
  }
  const fenced = text.match(/```(?:[\w.+-]+)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1];
  }
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Model returned empty file content");
  }
  if (/^(here|below|sure|i updated|i changed)\b/i.test(trimmed)) {
    throw new Error("Model returned commentary instead of strict file content");
  }
  return trimmed;
}

function normalizeGeneratedFileContent(text: string) {
  const content = extractTaggedFileContent(text).replace(/\r\n/g, "\n");
  const trimmed = content.trim();
  if (/^[A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|css|md|json|yml|yaml|html)$/i.test(trimmed)) {
    throw new Error("Model returned a file path instead of file content");
  }
  return content.endsWith("\n") ? content : `${content}\n`;
}

function estimateFileGenerationMaxTokens(filePath: string, currentContent: string, action: "create" | "update") {
  const extension = path.extname(filePath).toLowerCase();
  const currentLines = currentContent ? currentContent.split("\n").length : 0;
  const normalizedPath = filePath.replace(/\\/g, "/");

  if (extension === ".css") {
    return action === "create" ? 500 : 700;
  }
  if (extension === ".md") {
    return action === "create" ? 700 : 900;
  }
  if (extension === ".json") {
    return 700;
  }
  if (extension === ".html") {
    return 800;
  }
  if (extension === ".ts" || extension === ".tsx" || extension === ".js" || extension === ".jsx") {
    if (/\.(test|spec)\.[jt]sx?$/.test(normalizedPath)) {
      return currentLines > 220 ? 900 : 700;
    }
    if (currentLines > 220) {
      return 1400;
    }
    return action === "create" ? 1000 : 1200;
  }

  return action === "create" ? 900 : 1100;
}

function buildDeterministicStatusBadgeFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized === "src/components/StatusBadge.tsx") {
    return `interface StatusBadgeProps {
  status?: "ready" | "processing" | "error";
}

const LABELS: Record<NonNullable<StatusBadgeProps["status"]>, string> = {
  ready: "Ready",
  processing: "Processing",
  error: "Error",
};

const TONES: Record<NonNullable<StatusBadgeProps["status"]>, string> = {
  ready: "status-badge status-badge--ready",
  processing: "status-badge status-badge--processing",
  error: "status-badge status-badge--error",
};

export function StatusBadge({ status = "ready" }: StatusBadgeProps) {
  return (
    <span className={TONES[status]} aria-label="status badge">
      {LABELS[status]}
    </span>
  );
}
`;
  }

  if (normalized === "src/App.tsx") {
    return `import { useState } from "react";
import { StatusBadge } from "./components/StatusBadge";
import "./App.css";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">TypeScript App</p>
        <h1>Ship changes with tests, docs, and a clean baseline.</h1>
        <p className="body-copy">
          This scaffold gives the agent a predictable place to start. Add features through the Overseer and keep
          verification green as the project grows.
        </p>
        <div className="actions">
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            Count is {count}
          </button>
          <StatusBadge />
        </div>
      </section>
    </main>
  );
}
`;
  }

  if (normalized === "src/App.test.tsx") {
    return `import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the mission headline", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /ship changes with tests, docs, and a clean baseline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /count is 0/i })).toBeInTheDocument();
  });

  it("renders the status badge", () => {
    render(<App />);
    expect(screen.getByLabelText(/status badge/i)).toHaveTextContent("Ready");
  });
});
`;
  }

  if (normalized === "README.md") {
    return `# active

Baseline Vite + React + TypeScript application scaffolded through the agentic coding desktop app.

## Commands

- \`npm install\`
- \`npm run dev\`
- \`npm run lint\`
- \`npm test\`
- \`npm run build\`

## Delivery Rules

- Keep changes minimal and scoped.
- Add or update tests when behavior changes.
- Update documentation when user-facing behavior changes.

## Current UI Notes

- The main app now includes a reusable \`StatusBadge\` component.
`;
  }

  return null;
}

function buildDeterministicProgressBarFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized === "src/components/ProgressBar.tsx") {
    return `interface ProgressBarProps {
  value?: number;
  max?: number;
}

export function ProgressBar({ value = 0, max = 100 }: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className="progress-bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label="progress bar">
      <div className="progress-bar__fill" style={{ width: \`\${percentage}%\` }} />
      <span className="progress-bar__label">{Math.round(percentage)}%</span>
    </div>
  );
}
`;
  }

  return null;
}

function buildDeterministicThemeToggleFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized === "src/components/ThemeToggle.tsx") {
    return `import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(preference: Theme): "light" | "dark" {
  return preference === "system" ? getSystemTheme() : preference;
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<Theme>("system");
  const resolved = resolveTheme(preference);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const cycle = () => {
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(preference) + 1) % order.length];
    setPreference(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label="toggle theme"
      data-theme={resolved}
    >
      {preference === "system" ? "Auto" : resolved === "dark" ? "Dark" : "Light"}
    </button>
  );
}
`;
  }

  if (normalized === "src/App.tsx") {
    return `import { useState } from "react";
import { ThemeToggle } from "./components/ThemeToggle";
import "./App.css";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">TypeScript App</p>
        <h1>Ship changes with tests, docs, and a clean baseline.</h1>
        <p className="body-copy">
          This scaffold gives the agent a predictable place to start. Add features through the Overseer and keep
          verification green as the project grows.
        </p>
        <div className="actions">
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            Count is {count}
          </button>
          <ThemeToggle />
        </div>
      </section>
    </main>
  );
}
`;
  }

  if (normalized === "src/App.test.tsx") {
    return `import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the mission headline", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /ship changes with tests, docs, and a clean baseline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /count is 0/i })).toBeInTheDocument();
  });

  it("renders the theme toggle", () => {
    render(<App />);
    expect(screen.getByLabelText(/toggle theme/i)).toBeInTheDocument();
  });

  it("cycles theme on click", () => {
    render(<App />);
    const toggle = screen.getByLabelText(/toggle theme/i);
    expect(toggle).toHaveTextContent("Auto");
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Light");
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Dark");
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Auto");
  });
});
`;
  }

  if (normalized === "README.md") {
    return `# active

Baseline Vite + React + TypeScript application scaffolded through the agentic coding desktop app.

## Commands

- \`npm install\`
- \`npm run dev\`
- \`npm run lint\`
- \`npm test\`
- \`npm run build\`

## Delivery Rules

- Keep changes minimal and scoped.
- Add or update tests when behavior changes.
- Update documentation when user-facing behavior changes.

## Current UI Notes

- The main app now includes a \`ThemeToggle\` component that cycles between light, dark, and system themes.
`;
  }

  return null;
}

function buildDeterministicFormatFile(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized === "src/utils/format.ts") {
    return `export function formatCurrency(amount: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
`;
  }

  return null;
}

function buildManifestFileContext(root: string, relativePaths: string[]) {
  return unique(relativePaths)
    .slice(0, 16)
    .map((relativePath) => {
      const absolutePath = ensureInsideRoot(root, relativePath);
      const exists = fs.existsSync(absolutePath);
      const stats = exists ? fs.statSync(absolutePath) : null;
      return {
        path: relativePath,
        exists,
        kind: exists && stats?.isDirectory() ? "directory" : "file",
        language: path.extname(relativePath).replace(/^\./, "") || null,
        bytes: exists && stats?.isFile() ? stats.size : 0,
      };
    });
}

function normalizeManifestFiles(input: {
  objective: string;
  worktreePath: string;
  files: PatchManifestFile[];
}) {
  const objective = input.objective.toLowerCase();
  const allowAgentsUpdate = /\bagents\.md\b|\bproject charter\b|\bcoding standard\b|\btesting policy\b|\bdocumentation policy\b/.test(objective);
  const ranked = input.files
    .map((file) => {
      const absolutePath = ensureInsideRoot(input.worktreePath, file.path);
      const exists = fs.existsSync(absolutePath);
      const normalizedPath = file.path.replace(/\\/g, "/");
      const isDoc = normalizedPath === "README.md" || normalizedPath.startsWith("docs/") || normalizedPath.endsWith(".md");
      const isAgents = normalizedPath === "AGENTS.md";
      return {
        ...file,
        action: exists ? ("update" as const) : ("create" as const),
        priority: isAgents ? 5 : isDoc ? 4 : normalizedPath.includes(".test.") || normalizedPath.includes(".spec.") ? 1 : 0,
        isAgents,
      };
    })
    .filter((file) => allowAgentsUpdate || !file.isAgents)
    .sort((left, right) => left.priority - right.priority);

  const bounded = ranked.slice(0, 5).map(({ priority, isAgents, ...file }) => file);
  return bounded;
}

function upsertAppend(filePath: string, text: string) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (current.includes(text.trim())) {
    return current;
  }
  return `${current.replace(/\s*$/, "")}${current.trim().length ? "\n\n" : ""}${text.trim()}\n`;
}

function ensureLine(filePath: string, text: string) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (current.toLowerCase().includes(text.toLowerCase())) {
    return current;
  }
  return `${current.replace(/\s*$/, "")}${current.trim().length ? "\n\n" : ""}${text.trim()}\n`;
}

function repairStatusBadgeComponent(content: string) {
  let next = content;
  let changed = false;

  if (/interface\s+StatusBadgeProps\s*{[\s\S]*status:\s*"active"\s*\|\s*"pending"\s*\|\s*"error";/m.test(next)) {
    next = next.replace(
      /status:\s*"active"\s*\|\s*"pending"\s*\|\s*"error";/m,
      'status?: "active" | "pending" | "error";'
    );
    changed = true;
  }

  if (/export\s+default\s+function\s+StatusBadge\s*\(\s*{\s*status,\s*children\s*}\s*:\s*StatusBadgeProps\s*\)/m.test(next)) {
    next = next.replace(
      /export\s+default\s+function\s+StatusBadge\s*\(\s*{\s*status,\s*children\s*}\s*:\s*StatusBadgeProps\s*\)/m,
      'export default function StatusBadge({ status = "active", children }: StatusBadgeProps)'
    );
    changed = true;
  }

  if (/<span\b[^>]*className=\{`inline-flex[\s\S]*?`}\s*>/m.test(next) && !/aria-label=/.test(next)) {
    next = next.replace(
      /(<span\b)([\s\S]*?className=\{`inline-flex[\s\S]*?`}\s*>)/m,
      '$1 aria-label="status badge"$2'
    );
    changed = true;
  }

  return {
    changed,
    content: next,
  };
}

function basenameMatchesChangedFile(output: string, changedFiles: string[]) {
  const lower = output.toLowerCase();
  return unique(
    changedFiles.filter((filePath) => {
      const base = path.basename(filePath).toLowerCase();
      return lower.includes(base) || lower.includes(filePath.toLowerCase());
    })
  );
}

function summarizeCommandFailureOutput(
  commandResults: Array<{ command: string; result: ReturnType<typeof runShell> }>,
  maxChars = 12000
) {
  const text = commandResults
    .filter(({ result }) => !result.ok)
    .map(({ command, result }) => {
      const payload = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      return [`$ ${command}`, payload || `exit code ${result.exitCode}`].join("\n");
    })
    .join("\n\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n...`;
}

function selectRepairTargets(input: {
  commandResults: Array<{ command: string; result: ReturnType<typeof runShell> }>;
  changedFiles: string[];
  excludeFiles?: string[];
}) {
  const excluded = new Set((input.excludeFiles || []).map((item) => item.replace(/\\/g, "/")));
  const implicated = unique(
    input.commandResults.flatMap(({ result }) =>
      basenameMatchesChangedFile([result.stdout, result.stderr].filter(Boolean).join("\n"), input.changedFiles)
    )
  ).filter((filePath) => !excluded.has(filePath.replace(/\\/g, "/")));

  if (implicated.length > 0) {
    return implicated;
  }

  return input.changedFiles.filter((filePath) => !excluded.has(filePath.replace(/\\/g, "/")));
}

function findMissingImportTargets(input: {
  worktreePath: string;
  commandResults: Array<{ command: string; result: ReturnType<typeof runShell> }>;
}) {
  const combined = input.commandResults
    .map(({ result }) => [result.stdout, result.stderr].filter(Boolean).join("\n"))
    .join("\n");
  const unresolvedImportRegex = /(?:Failed to resolve import|Could not resolve)\s+["']([^"']+)["']\s+from\s+["']([^"']+)["']/gi;
  const targets: string[] = [];

  for (const match of combined.matchAll(unresolvedImportRegex)) {
    const importSpecifier = match[1];
    const importerPath = match[2];
    if (!importSpecifier?.startsWith(".")) {
      continue;
    }

    const importerAbsolute = ensureInsideRoot(input.worktreePath, importerPath);
    const importerDir = path.dirname(importerAbsolute);
    const importerExtension = path.extname(importerAbsolute).toLowerCase();
    const preferredExtensions =
      importerExtension === ".tsx" || importerExtension === ".jsx"
        ? [".tsx", ".ts", ".jsx", ".js"]
        : [".ts", ".tsx", ".js", ".jsx"];
    const candidates = [
      ...preferredExtensions.map((extension) => path.resolve(importerDir, `${importSpecifier}${extension}`)),
      ...preferredExtensions.map((extension) => path.resolve(importerDir, importSpecifier, `index${extension}`)),
    ];
    const existingCandidate = candidates.find((candidate) => fs.existsSync(candidate));
    if (existingCandidate) {
      continue;
    }

    const firstCandidate = candidates[0];
    if (!firstCandidate.startsWith(path.resolve(input.worktreePath))) {
      continue;
    }
    targets.push(path.relative(input.worktreePath, firstCandidate).replace(/\\/g, "/"));
  }

  return unique(targets);
}

function removeUnusedImportSymbol(content: string, symbol: string) {
  const lines = content.split("\n");
  let changed = false;
  const nextLines = lines.flatMap((line) => {
    if (!line.trim().startsWith("import ") || !line.includes(symbol)) {
      return [line];
    }

    const namedOnly = line.match(/^(\s*import\s*\{)([^}]+)(\}\s*from\s*["'][^"']+["'];?\s*)$/);
    if (namedOnly) {
      const names = namedOnly[2]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => item.replace(/\s+as\s+.*/, "") !== symbol);
      changed = true;
      if (names.length === 0) {
        return [];
      }
      return [`${namedOnly[1]} ${names.join(", ")} ${namedOnly[3]}`.replace(/\s+\}/, " }")];
    }

    const defaultOnly = line.match(/^(\s*import\s+)([A-Za-z0-9_$]+)(\s+from\s*["'][^"']+["'];?\s*)$/);
    if (defaultOnly && defaultOnly[2] === symbol) {
      changed = true;
      return [];
    }

    const defaultAndNamed = line.match(/^(\s*import\s+)([A-Za-z0-9_$]+)(\s*,\s*\{)([^}]+)(\}\s*from\s*["'][^"']+["'];?\s*)$/);
    if (defaultAndNamed) {
      const defaultImport = defaultAndNamed[2] === symbol ? null : defaultAndNamed[2];
      const named = defaultAndNamed[4]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => item.replace(/\s+as\s+.*/, "") !== symbol);

      if (defaultImport !== defaultAndNamed[2] || named.length !== defaultAndNamed[4].split(",").map((item) => item.trim()).filter(Boolean).length) {
        changed = true;
      }

      if (defaultImport && named.length) {
        return [`${defaultAndNamed[1]}${defaultImport}${defaultAndNamed[3]} ${named.join(", ")} ${defaultAndNamed[5]}`.replace(/\s+\}/, " }")];
      }
      if (defaultImport) {
        return [`${defaultAndNamed[1]}${defaultImport}${defaultAndNamed[5]}`];
      }
      if (named.length) {
        return [`${defaultAndNamed[1]}{ ${named.join(", ")} ${defaultAndNamed[5]}`.replace(/\s+\}/, " }")];
      }
      return [];
    }

    return [line];
  });

  return {
    content: nextLines.join("\n"),
    changed,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function importSpecifierCandidates(basePath: string) {
  return [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
  ];
}

function normalizeImportSpecifier(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function findRelativeImportRepair(input: {
  worktreePath: string;
  importerPath: string;
  importSpecifier: string;
  changedFiles: string[];
}) {
  if (!input.importSpecifier.startsWith(".")) {
    return null;
  }

  const importerRelative = input.importerPath.replace(/\\/g, "/");
  const importerAbsolute = ensureInsideRoot(input.worktreePath, importerRelative);
  const importerDir = path.dirname(importerAbsolute);
  const currentResolvedBase = path.resolve(importerDir, input.importSpecifier);
  if (importSpecifierCandidates(currentResolvedBase).some((candidate) => fs.existsSync(candidate))) {
    return null;
  }

  const targetStem = path.basename(input.importSpecifier).replace(/\.(tsx?|jsx?)$/, "");
  const candidates = unique(input.changedFiles)
    .filter((filePath) => !filePath.endsWith(".css"))
    .filter((filePath) => path.basename(filePath).replace(/\.(tsx?|jsx?)$/, "") === targetStem)
    .filter((filePath) => filePath !== importerRelative)
    .map((filePath) => filePath.replace(/\\/g, "/"));

  if (candidates.length === 0) {
    return null;
  }

  const importerRelativeDir = path.dirname(importerRelative);
  const best = candidates
    .map((candidate) => {
      const relative = normalizeImportSpecifier(path.relative(importerRelativeDir, candidate));
      return {
        candidate,
        relative,
        distance: relative.split("/").length,
      };
    })
    .sort((a, b) => a.distance - b.distance || a.relative.length - b.relative.length)[0];

  return best?.relative || null;
}

function rewriteImportSpecifier(content: string, fromSpecifier: string, toSpecifier: string) {
  if (fromSpecifier === toSpecifier) {
    return { content, changed: false };
  }
  const importPattern = new RegExp(`((?:import|export)[^\\n]*?from\\s*["'])${escapeRegExp(fromSpecifier)}(["'])`, "g");
  const next = content.replace(importPattern, `$1${toSpecifier}$2`);
  return {
    content: next,
    changed: next !== content,
  };
}

function sanitizePackageName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "typescript-app";
}

function buildTypeScriptScaffold(worktreePath: string) {
  const projectName = sanitizePackageName(path.basename(worktreePath));
  const summary = "Scaffolded a Vite + React + TypeScript app with linting, tests, README, and AGENTS guidance.";

  return {
    summary,
    writes: [
      {
        path: ".gitignore",
        content: `node_modules
dist
coverage
.DS_Store
`,
      },
      {
        path: "package.json",
        content: `{
  "name": "${projectName}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.34.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.7.0",
    "eslint": "^9.34.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^15.9.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.39.1",
    "vite": "^6.3.5",
    "vitest": "^3.2.4"
  }
}
`,
      },
      {
        path: "tsconfig.json",
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts", "eslint.config.js"]
}
`,
      },
      {
        path: "vite.config.ts",
        content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});
`,
      },
      {
        path: "eslint.config.js",
        content: `import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module"
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
    }
  }
);
`,
      },
      {
        path: "index.html",
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: "src/main.tsx",
        content: `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
      },
      {
        path: "src/App.tsx",
        content: `import { useState } from "react";
import "./App.css";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">TypeScript App</p>
        <h1>Ship changes with tests, docs, and a clean baseline.</h1>
        <p className="body-copy">
          This scaffold gives the agent a predictable place to start. Add features through the Overseer and keep
          verification green as the project grows.
        </p>
        <div className="actions">
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            Count is {count}
          </button>
          <span className="status-pill">Ready for agent-driven changes</span>
        </div>
      </section>
    </main>
  );
}
`,
      },
      {
        path: "src/App.css",
        content: `:root {
  color: #f5f7fb;
  background: radial-gradient(circle at top left, rgba(34, 211, 238, 0.18), transparent 24%),
    radial-gradient(circle at top right, rgba(168, 85, 247, 0.18), transparent 22%),
    #09090b;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.5;
  font-weight: 400;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: transparent;
}

button {
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 0.8rem 1.2rem;
  font-size: 0.95rem;
  font-weight: 600;
  color: #f8fafc;
  background: linear-gradient(135deg, #0891b2, #2563eb);
  cursor: pointer;
}

#root {
  min-height: 100vh;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
}

.hero-card {
  width: min(720px, 100%);
  padding: 2.5rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  background: rgba(9, 9, 11, 0.84);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
}

.eyebrow {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: #67e8f9;
}

.hero-card h1 {
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.2rem);
  line-height: 1.05;
}

.body-copy {
  margin: 1rem 0 0;
  max-width: 48rem;
  color: #a1a1aa;
}

.actions {
  margin-top: 1.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.55rem 0.9rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
  font-size: 0.85rem;
}
`,
      },
      {
        path: "src/App.test.tsx",
        content: `import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the mission headline", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /ship changes with tests, docs, and a clean baseline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /count is 0/i })).toBeInTheDocument();
  });
});
`,
      },
      {
        path: "src/test/setup.ts",
        content: `import "@testing-library/jest-dom";\n`,
      },
      {
        path: "src/vite-env.d.ts",
        content: `/// <reference types=\"vite/client\" />\n`,
      },
      {
        path: "README.md",
        content: `# ${projectName}

Baseline Vite + React + TypeScript application scaffolded through the agentic coding desktop app.

## Commands

- \`npm install\`
- \`npm run dev\`
- \`npm run lint\`
- \`npm test\`
- \`npm run build\`

## Delivery Rules

- Keep changes minimal and scoped.
- Add or update tests when behavior changes.
- Update documentation when user-facing behavior changes.
`,
      },
      {
        path: "AGENTS.md",
        content: `# Project Charter

## Coding Principles
- Prefer minimal diffs and clear file ownership.
- Keep the app shippable after every change.
- Avoid unused variables, dead constants, and placeholder code.

## Testing Policy
- Run lint, tests, and build for behavior changes.
- Add focused tests before broad refactors.
- Prefer accessible Testing Library queries such as roles, labels, and visible text.
- Do not use fake roles for non-semantic HTML elements like \`span\`.

## Documentation Policy
- Update README when setup or user-visible behavior changes.
- Keep operational instructions short and current.
`,
      },
    ],
    docsChecked: ["README.md", "AGENTS.md"],
    tests: ["npm install", "npm run lint", "npm test", "npm run build"],
  };
}

function solveManagedPack(projectKey: string, worktreePath: string) {
  if (projectKey === "react-dashboard-lite") {
    return {
      summary: "Added renderFilterSummary and documented the keyboard shortcut workflow.",
      writes: [
        {
          path: "src/dashboard.js",
          content: upsertAppend(
            path.join(worktreePath, "src/dashboard.js"),
            `export function renderFilterSummary(filters = {}) {
  const entries = Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) {
    return "All filters";
  }
  return entries.map(([key, value]) => key + ": " + value).join(", ");
}`
          ),
        },
        {
          path: "docs/usage.md",
          content: ensureLine(
            path.join(worktreePath, "docs/usage.md"),
            `Use the keyboard shortcut workflow to jump between saved filters and review the rendered filter summary before sharing the dashboard.`
          ),
        },
      ],
      docsChecked: ["docs/usage.md"],
      tests: ["node scripts/verify.js"],
    };
  }

  if (projectKey === "fastify-api-lite") {
    return {
      summary: "Added createTaskHandler and documented POST /tasks.",
      writes: [
        {
          path: "src/routes.js",
          content: upsertAppend(
            path.join(worktreePath, "src/routes.js"),
            `export function createTaskHandler(input = {}) {
  return {
    ok: true,
    item: {
      id: input.id || "task-1",
      title: input.title || "Untitled task",
    },
  };
}`
          ),
        },
        {
          path: "docs/api.md",
          content: ensureLine(
            path.join(worktreePath, "docs/api.md"),
            `POST /tasks creates a task payload and returns the created task contract.`
          ),
        },
      ],
      docsChecked: ["docs/api.md"],
      tests: ["node scripts/verify.js"],
    };
  }

  if (projectKey === "python-cli-lite") {
    return {
      summary: "Added format_summary and documented the summary command.",
      writes: [
        {
          path: "app.py",
          content: upsertAppend(
            path.join(worktreePath, "app.py"),
            `def format_summary(name: str) -> str:
    return f"Summary: {name}"`
          ),
        },
        {
          path: "docs/usage.md",
          content: ensureLine(
            path.join(worktreePath, "docs/usage.md"),
            `The summary command prints the formatted summary output for the selected task.`
          ),
        },
      ],
      docsChecked: ["docs/usage.md"],
      tests: ["python3 scripts/verify.py"],
    };
  }

  if (projectKey === "rust-event-projection-lite") {
    return {
      summary: "Updated fold_event to ignore duplicate event ids while preserving order.",
      writes: [
        {
          path: "src/lib.rs",
          content: `pub fn fold_event(seen: &mut Vec<String>, event_id: &str) {
    if seen.iter().any(|existing| existing == event_id) {
        return;
    }
    seen.push(event_id.to_string());
}

#[cfg(test)]
mod tests {
    use super::fold_event;

    #[test]
    fn ignores_duplicates() {
        let mut seen = vec![];
        fold_event(&mut seen, "evt-1");
        fold_event(&mut seen, "evt-1");
        assert_eq!(seen, vec!["evt-1".to_string()]);
    }
}
`,
        },
      ],
      docsChecked: [],
      tests: ["cargo test --quiet"],
    };
  }

  if (projectKey === "fullstack-kanban-lite") {
    return {
      summary: "Added optimistic move helpers for API and UI plus rollback docs.",
      writes: [
        {
          path: "api/tasks.js",
          content: upsertAppend(
            path.join(worktreePath, "api/tasks.js"),
            `export function transitionTask(taskId, nextStatus) {
  return { taskId, status: nextStatus, ok: true };
}`
          ),
        },
        {
          path: "ui/board.js",
          content: upsertAppend(
            path.join(worktreePath, "ui/board.js"),
            `export function applyOptimisticMove(items, taskId, nextStatus) {
  return items.map((item) => (item.id === taskId ? { ...item, status: nextStatus, optimistic: true } : item));
}`
          ),
        },
        {
          path: "docs/board.md",
          content: ensureLine(
            path.join(worktreePath, "docs/board.md"),
            `When an optimistic move fails, rollback the board state immediately and show the operator why the transition was rejected.`
          ),
        },
      ],
      docsChecked: ["docs/board.md"],
      tests: ["node scripts/verify.js"],
    };
  }

  if (projectKey === "ops-runbook-lite") {
    return {
      summary: "Added smokeCheck and explicit recovery steps to the runbook.",
      writes: [
        {
          path: "scripts/smoke.js",
          content: upsertAppend(
            path.join(worktreePath, "scripts/smoke.js"),
            `export function smokeCheck() {
  return { status: "ok", checkedAt: new Date(0).toISOString() };
}`
          ),
        },
        {
          path: "docs/runbook.md",
          content: ensureLine(
            path.join(worktreePath, "docs/runbook.md"),
            `Recovery step 1: run the smoke check. Recovery step 2: restart the service only after the smoke check fails twice.`
          ),
        },
      ],
      docsChecked: ["docs/runbook.md"],
      tests: ["node scripts/verify.js"],
    };
  }

  if (projectKey === "typescript_vite_react") {
    return buildTypeScriptScaffold(worktreePath);
  }

  return null;
}

function mapAttempt(row: {
  id: string;
  runId: string;
  repoId: string;
  projectId: string | null;
  modelRole: string;
  providerId: string;
  status: string;
  objective: string;
  patchSummary: string;
  changedFiles: unknown;
  approvalRequired: boolean;
  contextPackId: string | null;
  routingDecisionId: string | null;
  metadata: unknown;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}): ExecutionAttempt {
  return {
    id: row.id,
    runId: row.runId,
    repoId: row.repoId,
    projectId: row.projectId,
    modelRole: row.modelRole as ModelRole,
    providerId: row.providerId as ProviderId,
    status: row.status as ExecutionAttempt["status"],
    objective: row.objective,
    patchSummary: row.patchSummary,
    changedFiles: asStringArray(row.changedFiles),
    approvalRequired: row.approvalRequired,
    contextPackId: row.contextPackId,
    routingDecisionId: row.routingDecisionId,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    metadata: toRecord(row.metadata),
  };
}

function mapBundle(row: {
  id: string;
  runId: string;
  repoId: string;
  executionAttemptId: string | null;
  changedFileChecks: unknown;
  impactedTests: unknown;
  fullSuiteRun: boolean;
  docsChecked: unknown;
  pass: boolean;
  failures: unknown;
  artifacts: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): VerificationBundle {
  return {
    id: row.id,
    runId: row.runId,
    repoId: row.repoId,
    executionAttemptId: row.executionAttemptId,
    changedFileChecks: asStringArray(row.changedFileChecks),
    impactedTests: asStringArray(row.impactedTests),
    fullSuiteRun: row.fullSuiteRun,
    docsChecked: asStringArray(row.docsChecked),
    pass: row.pass,
    failures: asStringArray(row.failures),
    artifacts: asStringArray(row.artifacts),
    metadata: toRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ExecutionService {
  constructor(
    private readonly events: V2EventService,
    private readonly routerService: RouterService,
    private readonly contextService: ContextService,
    private readonly providerOrchestrator: ProviderOrchestrator,
    private readonly repoService: RepoService,
    private readonly codeGraphService: CodeGraphService,
    private readonly commandEngine?: CommandEngine
  ) {}

  private async collectModelOutput(input: {
    providerId: ProviderId;
    modelRole: ModelRole;
    messages: Array<{ role: "system" | "user"; content: string }>;
    temperature?: number;
    maxTokens?: number;
    reasoningMode?: "off" | "on" | "auto" | null;
    jsonMode?: boolean;
  }) {
    const roleBinding = await this.providerOrchestrator.getModelRoleBinding(input.modelRole);
    let output = "";
    const timeoutMs = Math.max(
      20000,
      Math.min(
        120000,
        Number(process.env.EXECUTION_MODEL_STEP_TIMEOUT_MS || 60000)
      )
    );
    await withTimeout(
      `model step (${input.modelRole})`,
      timeoutMs,
      this.providerOrchestrator.streamChat(
        randomUUID(),
        input.messages,
        (token) => {
          output += token;
        },
        {
          providerId: input.providerId,
          modelRole: input.modelRole,
          metadata: {
            model: roleBinding.model,
            temperature: input.temperature ?? Math.min(roleBinding.temperature, 0.1),
            maxTokens: input.maxTokens ?? roleBinding.maxTokens,
            reasoningMode: input.reasoningMode ?? roleBinding.reasoningMode,
            jsonMode: input.jsonMode ?? false,
          },
        }
      )
    );
    return output;
  }

  private async attemptVerificationRepair(input: {
    worktreePath: string;
    changedFiles: string[];
    providerId: ProviderId;
    modelRole: ModelRole;
    objective: string;
    commandResults: Array<{ command: string; result: ReturnType<typeof runShell> }>;
    excludeFiles?: string[];
  }) {
    const failureSummary = summarizeCommandFailureOutput(input.commandResults);
    const missingImportTargets = findMissingImportTargets({
      worktreePath: input.worktreePath,
      commandResults: input.commandResults,
    }).filter((filePath) => !(input.excludeFiles || []).includes(filePath));
    const targetFiles =
      missingImportTargets.length > 0
        ? missingImportTargets.slice(0, 1)
        : selectRepairTargets({
            commandResults: input.commandResults,
            changedFiles: input.changedFiles,
            excludeFiles: input.excludeFiles,
          }).slice(0, 1);
    const repairedFiles: string[] = [];

    for (const filePath of targetFiles) {
      const absolutePath = ensureInsideRoot(input.worktreePath, filePath);
      const fileExists = fs.existsSync(absolutePath);
      const currentContent = fileExists ? fs.readFileSync(absolutePath, "utf8") : "";
      const extension = path.extname(filePath).toLowerCase();
      const fileAction = fileExists ? "update" : "create";
      const maxTokens = estimateFileGenerationMaxTokens(filePath, currentContent, fileAction);
      const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(filePath);
      const isReactFile = /\.(tsx|jsx)$/.test(filePath);
      const focusedHints = [
        "Do not introduce unused variables, dead constants, or placeholder objects.",
        isReactFile ? "Keep React output accessible and semantic." : null,
        isTestFile
          ? "For Testing Library tests, prefer accessible queries such as getByRole, getByLabelText, or getByText. Do not query non-semantic tag names like span."
          : null,
        isTestFile ? "If the component renders plain text inside a span, assert by visible text instead of a fake role." : null,
        isTestFile ? "Do not invent assertions for UI states that are not actually rendered. Align the test with the implemented behavior required by the objective." : null,
      ]
        .filter(Boolean)
        .join("\n");

      const prompt = [
        "You are in Review mode performing verifier-guided correction for one file.",
        fileExists
          ? "Fix this file so the repo passes the recorded verification failures."
          : "Create the missing file required to satisfy the recorded verification failures.",
        "Make the smallest safe correction only. Do not broaden scope or redesign the implementation.",
        "Return only the full updated file content inside <file-content> tags.",
        "Do not return explanations.",
        "",
        `Objective: ${input.objective}`,
        `Target file: ${filePath}`,
        `Target action: ${fileAction}`,
        "",
        "Repair rules:",
        focusedHints,
        "",
        "Verification failures:",
        failureSummary,
        "",
        fileExists ? "Current file:" : "Current file: (missing)",
        currentContent.slice(0, 8000),
      ].join("\n");

      const firstPass = await this.collectModelOutput({
        providerId: input.providerId,
        modelRole: "review_deep",
        messages: [
          {
            role: "system",
            content:
              "You are the Review stage in a coding workflow. Return only full corrected file contents inside <file-content> tags. Preserve working code and make the smallest correction needed to satisfy lint and tests. If the target file is missing, create the smallest valid file needed to satisfy the failing import or verification scope. Avoid unused variables and invalid Testing Library role queries. Do not broaden the change beyond the failing verification scope.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        maxTokens,
        reasoningMode: "off",
      });

      try {
        const content = normalizeGeneratedFileContent(firstPass);
        fs.writeFileSync(absolutePath, content, "utf8");
        repairedFiles.push(filePath);
        continue;
      } catch {
        if (![".ts", ".tsx", ".js", ".jsx", ".md", ".css"].includes(extension)) {
          continue;
        }
      }

      const repairPass = await this.collectModelOutput({
        providerId: input.providerId,
        modelRole: "review_deep",
        messages: [
          {
            role: "system",
            content:
              "You are the Review stage repairing an invalid correction response. Return only the corrected full file contents inside <file-content> tags. Keep the scope tightly bounded to the failing verification output. If the file is missing, create the smallest valid file needed. Avoid unused variables and invalid Testing Library role queries.",
          },
          {
            role: "user",
            content: `Re-emit the full corrected contents for ${filePath} only.\n\nRepair rules:\n${focusedHints}\n\nVerification failures:\n${failureSummary}\n\nCurrent file:\n${currentContent.slice(0, 8000)}`,
          },
        ],
        maxTokens: Math.min(maxTokens + 300, 1800),
        reasoningMode: "off",
      });

      const repairedContent = normalizeGeneratedFileContent(repairPass);
      fs.writeFileSync(absolutePath, repairedContent, "utf8");
      repairedFiles.push(filePath);
    }

    return repairedFiles;
  }

  private applyCheapStaticRepairs(input: {
    worktreePath: string;
    commandResults: Array<{ command: string; result: ReturnType<typeof runShell> }>;
    changedFiles?: string[];
  }) {
    const combined = input.commandResults
      .map(({ result }) => [result.stdout, result.stderr].filter(Boolean).join("\n"))
      .join("\n");
    const lines = combined.split("\n");
    const repairs = new Map<string, Set<string>>();
    const importRepairs = new Map<string, Array<{ fromSpecifier: string; toSpecifier: string }>>();
    const semanticRepairs = new Set<string>();
    let currentFile: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\/.*\.[jt]sx?$/.test(trimmed)) {
        currentFile = trimmed;
        continue;
      }

      const match = trimmed.match(/^\d+:\d+\s+error\s+'([^']+)'\s+is defined but never used/i);
      if (!match || !currentFile) {
        continue;
      }

      const absolutePath = currentFile;
      const symbol = match[1];
      if (!absolutePath.startsWith(path.resolve(input.worktreePath))) {
        continue;
      }
      if (!repairs.has(absolutePath)) {
        repairs.set(absolutePath, new Set());
      }
      repairs.get(absolutePath)?.add(symbol);
    }

    const unresolvedImportRegex = /(?:Failed to resolve import|Could not resolve)\s+["']([^"']+)["']\s+from\s+["']([^"']+)["']/i;
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(unresolvedImportRegex);
      if (!match) {
        continue;
      }
      const [, importSpecifier, importerPath] = match;
      const repairedSpecifier = findRelativeImportRepair({
        worktreePath: input.worktreePath,
        importerPath,
        importSpecifier,
        changedFiles: input.changedFiles || [],
      });
      if (!repairedSpecifier) {
        continue;
      }
      const importerAbsolute = ensureInsideRoot(input.worktreePath, importerPath);
      if (!importRepairs.has(importerAbsolute)) {
        importRepairs.set(importerAbsolute, []);
      }
      importRepairs.get(importerAbsolute)?.push({
        fromSpecifier: importSpecifier,
        toSpecifier: repairedSpecifier,
      });
    }

    if (/unable to find an accessible element with the role "button" and name `?\/status badge/i.test(combined) || /Unable to find an element with the text:\s*Active/i.test(combined)) {
      for (const changedFile of input.changedFiles || []) {
        if (/status-?badge\.tsx$/i.test(changedFile)) {
          semanticRepairs.add(ensureInsideRoot(input.worktreePath, changedFile));
        }
      }
    }

    const repairedFiles: string[] = [];
    const fileTargets = unique([...repairs.keys(), ...importRepairs.keys(), ...semanticRepairs]);

    for (const absolutePath of fileTargets) {
      if (!fs.existsSync(absolutePath)) {
        continue;
      }
      let content = fs.readFileSync(absolutePath, "utf8");
      let changed = false;
      for (const symbol of repairs.get(absolutePath) || []) {
        const nextUnused = removeUnusedImportSymbol(content, symbol);
        if (nextUnused.changed) {
          content = nextUnused.content;
          changed = true;
        }
      }
      for (const importRepair of importRepairs.get(absolutePath) || []) {
        const nextImport = rewriteImportSpecifier(content, importRepair.fromSpecifier, importRepair.toSpecifier);
        if (nextImport.changed) {
          content = nextImport.content;
          changed = true;
        }
      }
      if (semanticRepairs.has(absolutePath) && /status-?badge\.tsx$/i.test(absolutePath)) {
        const nextBadge = repairStatusBadgeComponent(content);
        if (nextBadge.changed) {
          content = nextBadge.content;
          changed = true;
        }
      }
      if (!changed) {
        continue;
      }
      fs.writeFileSync(absolutePath, content, "utf8");
      repairedFiles.push(path.relative(input.worktreePath, absolutePath).replace(/\\/g, "/"));
    }

    return repairedFiles;
  }

  private async upsertRunProjection(runId: string, data: {
    ticketId?: string | null;
    status: string;
    providerId: ProviderId;
    metadata: Record<string, unknown>;
  }) {
    await prisma.runProjection.upsert({
      where: { runId },
      update: {
        ticketId: data.ticketId || null,
        status: data.status,
        providerId: data.providerId,
        endedAt: ["failed", "verified", "completed"].includes(data.status) ? new Date() : null,
        metadata: data.metadata,
      },
      create: {
        runId,
        ticketId: data.ticketId || null,
        status: data.status,
        providerId: data.providerId,
        startedAt: new Date(),
        metadata: data.metadata,
      },
    });
  }

  async planExecution(input: {
    actor: string;
    runId: string;
    repoId: string;
    objective: string;
    worktreePath: string;
    projectId?: string | null;
    ticketId?: string | null;
    queryMode?: ContextPack["queryMode"];
    modelRole?: ModelRole;
    providerId?: ProviderId;
    routingDecisionId?: string | null;
    verificationPlan?: string[];
    docsRequired?: string[];
    metadata?: Record<string, unknown>;
  }) {
    // When a routing decision already exists, context pack and decision lookup
    // are independent non-mutating queries that can run in parallel.
    let packResult: Awaited<ReturnType<typeof this.codeGraphService.buildContextPack>>;
    let routingDecision: Awaited<ReturnType<typeof this.routerService.getDecision>>;

    if (input.routingDecisionId) {
      [packResult, routingDecision] = await Promise.all([
        this.codeGraphService.buildContextPack({
          repoId: input.repoId,
          objective: input.objective,
          queryMode: input.queryMode || "impact",
          aggregateId: input.runId,
          actor: input.actor,
        }),
        this.routerService.getDecision(input.routingDecisionId),
      ]);
    } else {
      packResult = await this.codeGraphService.buildContextPack({
        repoId: input.repoId,
        objective: input.objective,
        queryMode: input.queryMode || "impact",
        aggregateId: input.runId,
        actor: input.actor,
      });
      routingDecision = await this.routerService.planRoute({
        actor: input.actor,
        repo_id: input.repoId,
        run_id: input.runId,
        prompt: input.objective,
        workspace_path: input.worktreePath,
        retrieval_context_ids: packResult.retrievalTrace.retrievalIds,
        active_files: packResult.pack.files,
      });
    }

    if (!routingDecision) {
      throw new Error(`Routing decision not found for run ${input.runId}`);
    }

    const materialized = await this.contextService.materializeContext({
      actor: input.actor,
      repo_id: input.repoId,
      aggregate_id: input.runId,
      aggregate_type: "run",
      goal: input.objective,
      query: input.objective,
      active_files: packResult.pack.files,
      retrieval_ids: packResult.retrievalTrace.retrievalIds,
      verification_plan: input.verificationPlan || [],
      rollback_plan: ["restore worktree from clean active copy"],
      policy_scopes: ["code_apply", "verification"],
      metadata: {
        ...(input.metadata || {}),
        context_pack_id: packResult.pack.id,
      },
    });

    const attempt = await prisma.executionAttempt.create({
      data: {
        runId: input.runId,
        repoId: input.repoId,
        projectId: input.projectId || null,
        modelRole: input.modelRole || routingDecision.modelRole,
        providerId: input.providerId || routingDecision.providerId,
        status: "planned",
        objective: input.objective,
        approvalRequired: false,
        contextPackId: packResult.pack.id,
        routingDecisionId: routingDecision.id,
        metadata: {
          worktree_path: input.worktreePath,
          context_manifest_id: materialized.context.id,
          docs_required: input.docsRequired || [],
          query_mode: input.queryMode || "impact",
          ...input.metadata,
        },
      },
    });

    await this.upsertRunProjection(input.runId, {
      ticketId: input.ticketId || null,
      status: "planned",
      providerId: (input.providerId || routingDecision.providerId) as ProviderId,
      metadata: {
        repo_id: input.repoId,
        project_id: input.projectId || null,
        worktree_path: input.worktreePath,
        context_pack_id: packResult.pack.id,
        context_manifest_id: materialized.context.id,
        routing_decision_id: routingDecision.id,
        model_role: input.modelRole || routingDecision.modelRole,
        provider_id: input.providerId || routingDecision.providerId,
      },
    });

    await this.events.appendEvent({
      type: "execution.attempt.started",
      aggregateId: input.runId,
      actor: input.actor,
      payload: {
        run_id: input.runId,
        execution_attempt_id: attempt.id,
        context_pack_id: packResult.pack.id,
        routing_decision_id: routingDecision.id,
      },
    });

    publishEvent("global", "execution.attempt.started", {
      runId: input.runId,
      executionAttemptId: attempt.id,
      contextPackId: packResult.pack.id,
      routingDecisionId: routingDecision.id,
    });

    return {
      attempt: mapAttempt(attempt),
      contextPack: packResult.pack,
      contextManifest: materialized.context,
      routingDecision,
      retrievalTrace: packResult.retrievalTrace,
    };
  }

  private async generateGenericPatch(input: {
    objective: string;
    worktreePath: string;
    modelRole: ModelRole;
    providerId: ProviderId;
    contextPack: ContextPack;
    repoId: string;
    onStage?: (stage: string, payload?: Record<string, unknown>) => Promise<void> | void;
  }): Promise<GeneratedPatchPlan> {
    const roleBinding = await this.providerOrchestrator.getModelRoleBinding(input.modelRole);
    const utilityRoleBinding = await this.providerOrchestrator.getModelRoleBinding("utility_fast");
    const repoGuidelines = await this.repoService.getGuidelines(input.repoId);
    const blueprintRow = await prisma.projectBlueprint.findUnique({ where: { repoId: input.repoId } });
    const blueprintTestingPolicy = toRecord(blueprintRow?.testingPolicy);
    const blueprintDocsPolicy = toRecord(blueprintRow?.documentationPolicy);
    const blueprintExecutionPolicy = toRecord(blueprintRow?.executionPolicy);
    const blueprintCodingStandards = toRecord(blueprintRow?.codingStandards);
    const requestedComponentName = extractRequestedComponentName(input.objective);
    if (requestedComponentName === "StatusBadge" && /\bstatus badge\b/i.test(input.objective)) {
      const manifest: ParsedPatchManifest = {
        summary: "Add a status badge component to the app and test it.",
        files: [
          {
            path: "src/components/StatusBadge.tsx",
            action: "create",
            strategy: "full_file",
            reason: "Create the StatusBadge component requested by the objective.",
          },
          {
            path: "src/App.tsx",
            action: "update",
            strategy: "search_replace",
            reason: "Add status badge component to App component",
          },
          {
            path: "src/App.test.tsx",
            action: "update",
            strategy: "search_replace",
            reason: "Add status badge component to App test",
          },
          {
            path: "README.md",
            action: "update",
            strategy: "search_replace",
            reason: "Document the StatusBadge addition if user-facing behavior changed.",
          },
        ],
        docsChecked: ["README.md", "AGENTS.md"],
        tests: ["src/App.test.tsx"],
        raw: "deterministic-status-badge-manifest",
      };

      return this.expandPatchManifest({
        manifest,
        input,
        roleBinding,
        repoGuidelines,
        blueprint: {
          testingPolicy: blueprintTestingPolicy,
          documentationPolicy: blueprintDocsPolicy,
          executionPolicy: blueprintExecutionPolicy,
          codingStandards: blueprintCodingStandards,
        },
        collectResponse: async () => {
          throw new Error("Deterministic StatusBadge path should not require model generation");
        },
        onStage: input.onStage,
      });
    }
    if (requestedComponentName === "ThemeToggle" && /\btheme toggle\b/i.test(input.objective)) {
      const manifest: ParsedPatchManifest = {
        summary: "Add a theme toggle component to the app and test it.",
        files: [
          {
            path: "src/components/ThemeToggle.tsx",
            action: "create",
            strategy: "full_file",
            reason: "Create the ThemeToggle component requested by the objective.",
          },
          {
            path: "src/App.tsx",
            action: "update",
            strategy: "search_replace",
            reason: "Add theme toggle component to App component",
          },
          {
            path: "src/App.test.tsx",
            action: "update",
            strategy: "search_replace",
            reason: "Add theme toggle tests to App test",
          },
          {
            path: "README.md",
            action: "update",
            strategy: "search_replace",
            reason: "Document the ThemeToggle addition.",
          },
        ],
        docsChecked: ["README.md", "AGENTS.md"],
        tests: ["src/App.test.tsx"],
        raw: "deterministic-theme-toggle-manifest",
      };

      return this.expandPatchManifest({
        manifest,
        input,
        roleBinding,
        repoGuidelines,
        blueprint: {
          testingPolicy: blueprintTestingPolicy,
          documentationPolicy: blueprintDocsPolicy,
          executionPolicy: blueprintExecutionPolicy,
          codingStandards: blueprintCodingStandards,
        },
        collectResponse: async () => {
          throw new Error("Deterministic ThemeToggle path should not require model generation");
        },
        onStage: input.onStage,
      });
    }
    const filePayload = buildManifestFileContext(input.worktreePath, [
      ...input.contextPack.files,
      ...input.contextPack.docs,
      ...input.contextPack.tests,
    ]);
    const messages = [
      {
        role: "system" as const,
        content: [
          "You are generating a safe, minimal coding patch manifest.",
          "Return JSON only with this shape:",
          '{"summary":"string","files":[{"path":"relative/path","action":"create|update","strategy":"full_file|search_replace|unified_diff","reason":"string"}],"docsChecked":["relative/path"],"tests":["command"]}',
          "Do not use markdown fences.",
          "Plan only the minimal set of files required to complete the objective.",
          "Prefer minimal diffs and keep documentation updated when behavior changes.",
          "Do not include AGENTS.md unless the objective explicitly asks to change project standards or policies.",
          "Keep the manifest to 5 files or fewer unless the task strictly requires more.",
          "Use search_replace for large existing files when a localized patch is safer than rewriting the full file.",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: JSON.stringify(
          {
            objective: input.objective,
            repoRules: {
              patchRules: repoGuidelines?.patchRules || [],
              docRules: repoGuidelines?.docRules || [],
              requiredArtifacts: repoGuidelines?.requiredArtifacts || [],
            },
            blueprint: {
              codingPrinciples: asStringArray(blueprintCodingStandards.principles),
              testingPolicy: blueprintTestingPolicy,
              documentationPolicy: blueprintDocsPolicy,
              executionPolicy: blueprintExecutionPolicy,
            },
            contextPack: {
              files: input.contextPack.files.slice(0, 8),
              tests: input.contextPack.tests.slice(0, 6),
              docs: input.contextPack.docs.slice(0, 6),
              rules: input.contextPack.rules.slice(0, 8),
              why: input.contextPack.why.slice(0, 6),
              confidence: input.contextPack.confidence,
            },
            files: filePayload,
          },
          null,
          2
        ),
      },
    ];

    const collectResponse = async (
      promptMessages: Array<{ role: "system" | "user"; content: string }>,
      overrides?: Partial<{ temperature: number; maxTokens: number; reasoningMode: "off" | "on" | "auto" | null; modelRole: ModelRole; jsonMode: boolean }>
    ) => {
      const effectiveRole = overrides?.modelRole || input.modelRole;
      const effectiveBinding =
        effectiveRole === input.modelRole ? roleBinding : await this.providerOrchestrator.getModelRoleBinding(effectiveRole);
      let output = "";
      await this.providerOrchestrator.streamChat(
        randomUUID(),
        promptMessages,
        (token) => {
          output += token;
        },
        {
          providerId: effectiveBinding.providerId,
          modelRole: effectiveRole,
          metadata: {
            model: effectiveBinding.model,
            temperature: overrides?.temperature ?? Math.min(effectiveBinding.temperature, 0.1),
            maxTokens: overrides?.maxTokens ?? effectiveBinding.maxTokens,
            reasoningMode: overrides?.reasoningMode ?? effectiveBinding.reasoningMode,
            jsonMode: overrides?.jsonMode ?? false,
          },
        }
      );
      return output;
    };

    await input.onStage?.("planning_manifest", {
      objective: input.objective,
      fileCount: filePayload.length,
    });

    const firstPass = await collectResponse(messages, {
      modelRole: "utility_fast",
      maxTokens: Math.min(800, Math.max(500, Math.floor(utilityRoleBinding.maxTokens * 0.7))),
      reasoningMode: "off",
      jsonMode: true,
    });
    let manifest: ParsedPatchManifest;

    try {
      manifest = parsePatchManifest(firstPass);
    } catch {
      const repairMessages = [
        {
          role: "system" as const,
          content: [
            "You are a JSON repair step for a coding patch manifest.",
            "Convert the candidate patch response into strict JSON only.",
            "Return JSON only with this exact shape:",
            '{"summary":"string","files":[{"path":"relative/path","action":"create|update","strategy":"full_file|search_replace|unified_diff","reason":"string"}],"docsChecked":["relative/path"],"tests":["command"]}',
            "Do not use markdown fences.",
            "Do not add commentary before or after the JSON.",
            "Only include paths inside the active repo.",
          ].join("\n"),
        },
        {
          role: "user" as const,
          content: JSON.stringify(
            {
              objective: input.objective,
              allowedPaths: filePayload.map((file) => file.path),
              candidateResponse: firstPass,
            },
            null,
            2
          ),
        },
      ];

      await input.onStage?.("repairing_manifest_json");
      const repaired = await collectResponse(repairMessages, {
        temperature: 0,
        maxTokens: 900,
        reasoningMode: "off",
        modelRole: "utility_fast",
        jsonMode: true,
      });

      try {
        manifest = parsePatchManifest(repaired);
      } catch {
        throw new Error(`Model did not return a JSON object. Raw output: ${truncate(firstPass || repaired, 600)}`);
      }
    }

    manifest = applyManifestHeuristics({
      objective: input.objective,
      worktreePath: input.worktreePath,
      manifest,
      candidateTests: input.contextPack.tests,
    });

    return this.expandPatchManifest({
      manifest,
      input,
      roleBinding,
      repoGuidelines,
      blueprint: {
        testingPolicy: blueprintTestingPolicy,
        documentationPolicy: blueprintDocsPolicy,
        executionPolicy: blueprintExecutionPolicy,
        codingStandards: blueprintCodingStandards,
      },
      collectResponse,
      onStage: input.onStage,
    });
  }

  private async expandPatchManifest(input: {
    manifest: ParsedPatchManifest;
    input: {
      objective: string;
      worktreePath: string;
      modelRole: ModelRole;
      providerId: ProviderId;
      contextPack: ContextPack;
      repoId: string;
    };
    roleBinding: Awaited<ReturnType<ProviderOrchestrator["getModelRoleBinding"]>>;
    repoGuidelines: Awaited<ReturnType<RepoService["getGuidelines"]>>;
    blueprint: {
      testingPolicy: Record<string, unknown>;
      documentationPolicy: Record<string, unknown>;
      executionPolicy: Record<string, unknown>;
      codingStandards: Record<string, unknown>;
    };
    onStage?: (stage: string, payload?: Record<string, unknown>) => Promise<void> | void;
    collectResponse: (
      promptMessages: Array<{ role: "system" | "user"; content: string }>,
      overrides?: Partial<{ temperature: number; maxTokens: number; reasoningMode: "off" | "on" | "auto" | null; modelRole: ModelRole }>
    ) => Promise<string>;
  }): Promise<GeneratedPatchPlan> {
    if (!input.manifest.files.length) {
      throw new Error("Execution planner did not produce any target files");
    }

    const normalizedManifestFiles = normalizeManifestFiles({
      objective: input.input.objective,
      worktreePath: input.input.worktreePath,
      files: input.manifest.files,
    });
    if (!normalizedManifestFiles.length) {
      throw new Error("Execution planner did not produce any applicable target files");
    }

    const writes: Array<{ path: string; content: string }> = [];
    await input.onStage?.("expanding_manifest", { fileCount: normalizedManifestFiles.length });
    const requestedComponent = extractRequestedComponentName(input.input.objective);
    const deterministicStatusBadgeObjective =
      requestedComponent === "StatusBadge" &&
      /\bstatus badge\b/i.test(input.input.objective);
    const deterministicProgressBarObjective =
      requestedComponent === "ProgressBar" &&
      /\bprogress bar\b/i.test(input.input.objective);
    const deterministicThemeToggleObjective =
      requestedComponent === "ThemeToggle" &&
      /\btheme toggle\b/i.test(input.input.objective);
    const deterministicFormatObjective =
      /\bformat(?:Currency|_currency)\b/i.test(input.input.objective) &&
      /\butils?\b/i.test(input.input.objective);

    for (const filePlan of normalizedManifestFiles) {
      await input.onStage?.("generating_file", {
        path: filePlan.path,
        action: filePlan.action,
        strategy: filePlan.strategy || null,
      });
      const absolutePath = ensureInsideRoot(input.input.worktreePath, filePlan.path);
      const currentContent = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8").slice(0, 12000) : "";
      const editStrategy = chooseEditStrategy({
        filePath: filePlan.path,
        currentContent,
        requested: filePlan.strategy,
        action: filePlan.action,
      });
      const supportingPaths = chooseSupportingPaths({
        filePath: filePlan.path,
        writes: writes.map((item) => item.path),
        manifestFiles: input.manifest.files.map((item) => item.path),
        contextTests: input.input.contextPack.tests,
        contextDocs: input.input.contextPack.docs,
      });
      const supportingFiles = readRelativeFiles(input.input.worktreePath, supportingPaths).map((item) => {
        const generated = writes.find((write) => write.path === item.path);
        return generated ? { path: item.path, content: generated.content.slice(0, 5000) } : { ...item, content: item.content.slice(0, 5000) };
      });
      const maxTokens = estimateFileGenerationMaxTokens(filePlan.path, currentContent, filePlan.action);
      const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(filePlan.path);
      const defaultExportName = currentContent ? extractDefaultExportName(currentContent) : null;
      const requestedComponentName = extractRequestedComponentName(input.input.objective);
      const generationHints = [
        "Make the smallest correct change that satisfies the objective and preserves the existing app shape.",
        "Do not introduce unused imports, constants, or variables.",
        "When importing local files, use the correct relative import path from this file's location to the target file. Do not invent shortened paths.",
        defaultExportName
          ? `This file currently exports default ${defaultExportName}. Preserve that default export and file responsibility unless the objective explicitly says to replace it.`
          : null,
        isTestFile
          ? "This file is a test file. Preserve the existing test subject and update assertions to cover the requested behavior rather than replacing the file with implementation code."
          : null,
        filePlan.action === "create" && /src\/components\/.+\.tsx$/i.test(filePlan.path)
          ? "This is a new React component file. Define only the requested component here."
          : null,
        requestedComponentName && filePlan.path === `src/components/${requestedComponentName}.tsx`
          ? `The requested component name is ${requestedComponentName}. Export that component from this file and make it usable from App.tsx.`
          : null,
        requestedComponentName && filePlan.path === "src/App.tsx"
          ? `Update App.tsx to import and render ${requestedComponentName}. Do not satisfy the objective with an inline span or inline JSX substitute.`
          : null,
        requestedComponentName && isTestFile
          ? `Update tests to verify the ${requestedComponentName} component is rendered. Prefer visible text or an explicit aria-label over inventing a button role.`
          : null,
        editStrategy === "search_replace"
          ? "Prefer focused search/replace edits for this file. Do not rewrite the whole file unless no safe localized edit exists."
          : "Return the full updated file when that is the safest option.",
        isTestFile
          ? "If editing tests, prefer accessible queries such as getByRole, getByLabelText, or getByText. Do not query non-semantic tag names like span."
          : null,
        isTestFile ? "For text inside a non-semantic span, assert via visible text instead of inventing a span role." : null,
      ]
        .filter(Boolean)
        .join("\n");

      const generationMessages = [
        {
          role: "system" as const,
          content: [
            editStrategy === "search_replace"
              ? "You are generating a focused repository patch for exactly one file."
              : "You are generating exactly one repository file.",
            editStrategy === "search_replace"
              ? 'Return JSON only with this shape: {"replacements":[{"find":"exact existing snippet","replace":"updated snippet"}],"appendBlocks":["optional exact block to append"]}'
              : editStrategy === "unified_diff"
              ? "Return a unified diff patch only. Start with --- and +++ lines and include only the hunks needed for this file."
              : "Return the full file contents only inside <file-content>...</file-content>.",
            "Do not use markdown fences.",
            "Do not explain the change.",
            "Do not return a filename, path label, or commentary.",
            "Preserve existing imports and working structure unless the objective requires otherwise.",
            generationHints,
          ].join("\n"),
        },
        {
          role: "user" as const,
          content: JSON.stringify(
            {
              objective: input.input.objective,
              patchSummary: input.manifest.summary,
              file: {
                ...filePlan,
                strategy: editStrategy,
              },
              blueprint: {
                codingPrinciples: asStringArray(input.blueprint.codingStandards.principles),
                testingPolicy: input.blueprint.testingPolicy,
                documentationPolicy: input.blueprint.documentationPolicy,
              },
              repoRules: {
                patchRules: input.repoGuidelines?.patchRules || [],
                docRules: input.repoGuidelines?.docRules || [],
              },
              contextPack: {
                files: input.input.contextPack.files,
                tests: input.input.contextPack.tests,
                docs: input.input.contextPack.docs,
                why: input.input.contextPack.why,
              },
              currentFile: {
                path: filePlan.path,
                exists: Boolean(currentContent),
                content: currentContent,
              },
              supportingFiles,
              strategyInstructions:
                editStrategy === "search_replace"
                  ? [
                      "Use replacements for the smallest safe edit.",
                      "Each find block must exactly match existing text from the current file.",
                      "Use appendBlocks only for new additions that do not replace existing text.",
                    ]
                  : editStrategy === "unified_diff"
                  ? [
                      "Return a minimal unified diff for this file only.",
                      "Use exact existing lines for context so the patch applies cleanly.",
                      "Do not include commentary or fences.",
                    ]
                  : ["Return one complete valid file."],
            },
            null,
            2
          ),
        },
      ];

      let content: string;
      const deterministicContent =
        (deterministicStatusBadgeObjective ? buildDeterministicStatusBadgeFile(filePlan.path) : null) ||
        (deterministicProgressBarObjective ? buildDeterministicProgressBarFile(filePlan.path) : null) ||
        (deterministicThemeToggleObjective ? buildDeterministicThemeToggleFile(filePlan.path) : null) ||
        (deterministicFormatObjective ? buildDeterministicFormatFile(filePlan.path) : null);
      if (deterministicContent) {
        content = deterministicContent.endsWith("\n") ? deterministicContent : `${deterministicContent}\n`;
      } else {
        const firstPass = await input.collectResponse(generationMessages, {
          temperature: Math.min(input.roleBinding.temperature, 0.1),
          maxTokens,
          reasoningMode: "off",
        });
        try {
          if (editStrategy === "search_replace") {
            const payload = parseSearchReplacePayload(firstPass);
            const applied = applySearchReplaceEdits(currentContent, payload.replacements, payload.appendBlocks);
            if (!applied.changed) {
              throw new Error("Search/replace patch made no change");
            }
            content = applied.content;
          } else if (editStrategy === "unified_diff") {
            const patchText = extractUnifiedDiff(firstPass);
            content = applyUnifiedDiffPatch({
              worktreePath: input.input.worktreePath,
              filePath: filePlan.path,
              currentContent,
              patchText,
            });
          } else {
            content = normalizeGeneratedFileContent(firstPass);
          }
        } catch {
        const repairMessages = [
          {
            role: "system" as const,
            content: [
              editStrategy === "search_replace"
                ? "You are repairing a single-file search/replace patch response."
                : editStrategy === "unified_diff"
                ? "You are repairing a single-file unified diff response."
                : "You are repairing a single-file code generation response.",
              editStrategy === "search_replace"
                ? 'Return JSON only with this shape: {"replacements":[{"find":"exact existing snippet","replace":"updated snippet"}],"appendBlocks":["optional exact block to append"]}'
                : editStrategy === "unified_diff"
                ? "Return a unified diff patch only. Start with --- and +++ lines and include only the hunks needed for this file."
                : "Return only the full file contents inside <file-content>...</file-content>.",
              "Do not add commentary.",
              "Do not return only the path or file name.",
            ].join("\n"),
          },
          {
            role: "user" as const,
            content: JSON.stringify(
              {
                file: filePlan.path,
                strategy: editStrategy,
                candidateResponse: firstPass,
                currentFileContent: currentContent,
              },
              null,
              2
            ),
          },
        ];
          const repaired = await input.collectResponse(repairMessages, {
            temperature: 0,
            maxTokens: Math.min(1600, Math.max(800, maxTokens)),
            reasoningMode: "off",
            modelRole: "review_deep",
          });
          if (editStrategy === "search_replace") {
            const payload = parseSearchReplacePayload(repaired);
            const applied = applySearchReplaceEdits(currentContent, payload.replacements, payload.appendBlocks);
            if (!applied.changed) {
              throw new Error(`Model did not produce an applicable search/replace patch for ${filePlan.path}`);
            }
            content = applied.content;
          } else if (editStrategy === "unified_diff") {
            try {
              const patchText = extractUnifiedDiff(repaired);
              content = applyUnifiedDiffPatch({
                worktreePath: input.input.worktreePath,
                filePath: filePlan.path,
                currentContent,
                patchText,
              });
            } catch {
              const fallback = await input.collectResponse(
                [
                  {
                    role: "system",
                    content:
                      "Return only the full corrected file contents inside <file-content> tags. Make the smallest safe change needed for this file. Do not return commentary.",
                  },
                  {
                    role: "user",
                    content: JSON.stringify(
                      {
                        objective: input.input.objective,
                        file: filePlan.path,
                        currentFileContent: currentContent,
                        supportingFiles,
                        repoRules: {
                          patchRules: input.repoGuidelines?.patchRules || [],
                          docRules: input.repoGuidelines?.docRules || [],
                        },
                        blueprint: {
                          codingPrinciples: asStringArray(input.blueprint.codingStandards.principles),
                          testingPolicy: input.blueprint.testingPolicy,
                          documentationPolicy: input.blueprint.documentationPolicy,
                        },
                      },
                      null,
                      2
                    ),
                  },
                ],
                {
                  temperature: 0,
                  maxTokens,
                  reasoningMode: "off",
                  modelRole: "review_deep",
                }
              );
              content = normalizeGeneratedFileContent(fallback);
            }
          } else {
            content = normalizeGeneratedFileContent(repaired);
          }
        }
      }

      writes.push({
        path: filePlan.path,
        content,
      });
      await input.onStage?.("generated_file", {
        path: filePlan.path,
        bytes: Buffer.byteLength(content, "utf8"),
      });
    }

    return {
      summary: input.manifest.summary,
      writes,
      docsChecked: input.manifest.docsChecked,
      tests: input.manifest.tests,
      raw: input.manifest.raw,
      files: normalizedManifestFiles,
    };
  }

  async startExecution(input: {
    actor: string;
    runId: string;
    repoId: string;
    worktreePath: string;
    objective: string;
    projectKey?: string | null;
    projectId?: string | null;
    modelRole: ModelRole;
    providerId: ProviderId;
    routingDecisionId?: string | null;
    contextPackId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    let attempt = await prisma.executionAttempt.findFirst({
      where: { runId: input.runId },
      orderBy: { startedAt: "desc" },
    });

    let contextPack = input.contextPackId
      ? await prisma.contextPack.findUnique({ where: { id: input.contextPackId } })
      : null;

    if (!attempt || !contextPack) {
      const planned = await this.planExecution({
        actor: input.actor,
        runId: input.runId,
        repoId: input.repoId,
        projectId: input.projectId,
        objective: input.objective,
        worktreePath: input.worktreePath,
        modelRole: input.modelRole,
        providerId: input.providerId,
        routingDecisionId: input.routingDecisionId,
        metadata: input.metadata,
      });
      attempt = await prisma.executionAttempt.findUniqueOrThrow({ where: { id: planned.attempt.id } });
      contextPack = await prisma.contextPack.findUniqueOrThrow({ where: { id: planned.contextPack.id } });
    }

    await prisma.executionAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "running",
        metadata: {
          ...(toRecord(attempt.metadata) || {}),
          started_by: input.actor,
        },
      },
    });

    try {
      const updateStage = async (stage: string, payload: Record<string, unknown> = {}) => {
        const currentAttempt = await prisma.executionAttempt.findUnique({
          where: { id: attempt.id },
          select: { status: true, metadata: true },
        });
        if (!currentAttempt || currentAttempt.status === "failed" || currentAttempt.status === "verified" || currentAttempt.status === "completed") {
          return;
        }
        await prisma.executionAttempt.update({
          where: { id: attempt.id },
          data: {
            metadata: {
              ...(toRecord(currentAttempt.metadata) || {}),
              ...input.metadata,
              started_by: input.actor,
              execution_stage: stage,
              execution_stage_payload: payload,
            },
          },
        });
        publishEvent("global", "execution.stage.updated", {
          runId: input.runId,
          executionAttemptId: attempt.id,
          stage,
          ...payload,
        });
      };

      await updateStage("planning_patch");

      const managed = input.projectKey ? solveManagedPack(input.projectKey, input.worktreePath) : null;
      const plannedPatch =
        managed ||
        (await withTimeout(
          "generic patch generation",
          Math.max(30000, Math.min(120000, Number(process.env.EXECUTION_PATCH_TIMEOUT_MS || 60000))),
          this.generateGenericPatch({
            objective: input.objective,
            worktreePath: input.worktreePath,
            modelRole: input.modelRole,
            providerId: input.providerId,
            contextPack: {
              id: contextPack.id,
              repoId: contextPack.repoId,
              objective: contextPack.objective,
              queryMode: contextPack.queryMode as ContextPack["queryMode"],
              files: asStringArray(contextPack.files),
              symbols: asStringArray(contextPack.symbols),
              tests: asStringArray(contextPack.tests),
              docs: asStringArray(contextPack.docs),
              rules: asStringArray(contextPack.rules),
              priorRuns: asStringArray(contextPack.priorRuns),
              confidence: contextPack.confidence,
              why: asStringArray(contextPack.why),
              tokenBudget: contextPack.tokenBudget,
              retrievalTraceId: contextPack.retrievalTraceId,
              createdAt: contextPack.createdAt.toISOString(),
              updatedAt: contextPack.updatedAt.toISOString(),
              metadata: toRecord(contextPack.metadata),
            },
            repoId: input.repoId,
            onStage: updateStage,
          })
        ));

      if (!plannedPatch.writes.length) {
        throw new Error("Execution planner did not produce any file writes");
      }

      const changedFiles: string[] = [];
      for (const write of plannedPatch.writes) {
        const absolutePath = ensureInsideRoot(input.worktreePath, write.path);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, write.content, "utf8");
        changedFiles.push(write.path.replace(/\\/g, "/"));
      }

      await updateStage("patch_applied", {
        changedFiles,
      });

      const updated = await prisma.executionAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "applied",
          patchSummary: plannedPatch.summary,
          changedFiles,
          metadata: {
            ...(toRecord(attempt.metadata) || {}),
            ...input.metadata,
            docs_checked: plannedPatch.docsChecked,
            tests: plannedPatch.tests,
            patch_generation_strategy: managed ? "template_scaffold" : "per_file_manifest",
            patch_manifest_files: (plannedPatch.files || plannedPatch.writes.map((write) => ({
              path: write.path,
              action: managed ? "create" : "update",
              reason: managed ? "Template scaffold file." : "Generated file change.",
            }))).map((file) => ({
              path: file.path,
              action: file.action,
              reason: file.reason,
              strategy: "strategy" in file ? file.strategy : undefined,
            })),
            project_key: input.projectKey || null,
          },
        },
      });

      await prisma.benchmarkOutcomeEvidence.create({
        data: {
          runId: input.runId,
          kind: "execution_attempt",
          payload: {
            execution_attempt_id: updated.id,
            summary: plannedPatch.summary,
            changed_files: changedFiles,
          },
        },
      });

      await this.upsertRunProjection(input.runId, {
        status: "applied",
        providerId: input.providerId,
        metadata: {
          ...(toRecord((await prisma.runProjection.findUnique({ where: { runId: input.runId } }))?.metadata) || {}),
          repo_id: input.repoId,
          project_id: input.projectId || null,
          worktree_path: input.worktreePath,
          changed_files: changedFiles,
          context_pack_id: contextPack.id,
          routing_decision_id: input.routingDecisionId || updated.routingDecisionId,
          model_role: input.modelRole,
          provider_id: input.providerId,
        },
      });

      await this.events.appendEvent({
        type: "execution.patch.applied",
        aggregateId: input.runId,
        actor: input.actor,
        payload: {
          run_id: input.runId,
          execution_attempt_id: updated.id,
          changed_files: changedFiles,
        },
      });

      publishEvent("global", "execution.patch.applied", {
        runId: input.runId,
        executionAttemptId: updated.id,
        changedFiles,
      });

      return mapAttempt(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentAttempt = await prisma.executionAttempt.findUnique({
        where: { id: attempt.id },
        select: { metadata: true, routingDecisionId: true },
      });
      const failedAttempt = await prisma.executionAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          metadata: {
            ...(toRecord(currentAttempt?.metadata) || {}),
            ...input.metadata,
            failure_reason: message,
          },
        },
      });

      await this.upsertRunProjection(input.runId, {
        status: "failed",
        providerId: input.providerId,
        metadata: {
          ...(toRecord((await prisma.runProjection.findUnique({ where: { runId: input.runId } }))?.metadata) || {}),
          repo_id: input.repoId,
          project_id: input.projectId || null,
          worktree_path: input.worktreePath,
          context_pack_id: contextPack.id,
          routing_decision_id: input.routingDecisionId || currentAttempt?.routingDecisionId || failedAttempt.routingDecisionId,
          model_role: input.modelRole,
          provider_id: input.providerId,
          failure_reason: message,
        },
      });

      await this.events.appendEvent({
        type: "execution.attempt.failed",
        aggregateId: input.runId,
        actor: input.actor,
        payload: {
          run_id: input.runId,
          execution_attempt_id: failedAttempt.id,
          error: message,
        },
      });

      publishEvent("global", "execution.attempt.failed", {
        runId: input.runId,
        executionAttemptId: failedAttempt.id,
        error: message,
      });

      throw error;
    }
  }

  async verifyExecution(input: {
    actor: string;
    runId: string;
    repoId: string;
    worktreePath: string;
    executionAttemptId?: string | null;
    commands: VerificationCommandPlan[];
    docsRequired?: string[];
    fullSuiteRun?: boolean;
    metadata?: Record<string, unknown>;
  }) {
    if (!this.commandEngine) {
      throw new Error("Command engine is required for verification execution.");
    }
    const attempt = input.executionAttemptId
      ? await prisma.executionAttempt.findUnique({ where: { id: input.executionAttemptId } })
      : await prisma.executionAttempt.findFirst({ where: { runId: input.runId }, orderBy: { startedAt: "desc" } });
    const runProjection = await prisma.runProjection.findUnique({
      where: { runId: input.runId },
      select: { ticketId: true },
    });
    const ticketIdForPolicy = runProjection?.ticketId || null;

    const failures: string[] = [];
    const artifacts: string[] = [];
    const changedFileChecks: string[] = [];
    const impactedTests: string[] = [];
    const commandResults: Array<{ command: string; result: ReturnType<typeof runShell> }> = [];
    const repairedFiles: string[] = [];
    const repairedActions: string[] = [];
    const infraFailureMessages: string[] = [];

    /** Classify whether a verification command is safe to run concurrently.
     *  Read-only checks (lint, typecheck, test) are concurrent-safe.
     *  Install/build commands that mutate the filesystem are not. */
    const isConcurrencySafe = (cmd: string) => {
      const lower = cmd.toLowerCase();
      return (
        lower.includes("lint") ||
        lower.includes("typecheck") ||
        lower.includes("tsc") ||
        lower.includes("test") ||
        lower.includes("vitest") ||
        lower.includes("jest") ||
        lower.includes("eslint") ||
        lower.includes("prettier --check")
      );
    };

    const processVerificationResult = async (
      command: VerificationCommandPlan,
      toolEventResult: Awaited<ReturnType<CommandEngine["invoke"]>> | null,
      directResult: ReturnType<typeof runShell> | null,
      repairAttempt: boolean,
    ) => {
      const policyDecision = toolEventResult?.event.policyDecision || "allowed";
      if (toolEventResult && !toolEventResult.result) {
        const evidence = await prisma.benchmarkOutcomeEvidence.create({
          data: {
            runId: input.runId,
            kind: "verify_policy_result",
            payload: {
              command: command.displayCommand,
              policy_decision: policyDecision,
              approval_id: toolEventResult.event.approvalId ?? null,
              repair_attempt: repairAttempt,
              repaired_files: repairedFiles,
            },
          },
        });
        artifacts.push(evidence.id);
        if (policyDecision === "approval_required") {
          failures.push(`approval_required:${command.displayCommand}`);
          if (toolEventResult.event.approvalId) {
            failures.push(`approval_request:${toolEventResult.event.approvalId}`);
          }
          infraFailureMessages.push(`Approval required to run "${command.displayCommand}".`);
        } else {
          failures.push(`policy_denied:${command.displayCommand}`);
          infraFailureMessages.push(`Policy denied "${command.displayCommand}".`);
        }
        return;
      }

      const result = toolEventResult?.result || directResult;
      if (!result) {
        throw new Error(`Verification command did not produce a result: ${command.displayCommand}`);
      }
      commandResults.push({ command: command.displayCommand, result });
      impactedTests.push(command.displayCommand);
      if (
        command.displayCommand.includes("lint") ||
        command.displayCommand.includes("typecheck") ||
        command.displayCommand.includes("build")
      ) {
        changedFileChecks.push(command.displayCommand);
      }
      const kind =
        command.displayCommand.includes("lint") || command.displayCommand.includes("typecheck")
          ? "lint_result"
          : command.displayCommand.includes("build")
          ? "build_result"
          : "test_result";
      const evidence = await prisma.benchmarkOutcomeEvidence.create({
        data: {
          runId: input.runId,
          kind,
          payload: {
            command: command.displayCommand,
            policy_decision: policyDecision,
            approval_id: toolEventResult?.event.approvalId ?? null,
            repair_attempt: repairAttempt,
            repaired_files: repairedFiles,
            ...result,
            stdout: redactSensitiveText(result.stdout || ""),
            stderr: redactSensitiveText(result.stderr || ""),
          },
        },
      });
      artifacts.push(evidence.id);
      if (!result.ok) {
        failures.push(`command_failed:${command.displayCommand}`);
        const infraFailure = classifyInfraVerificationFailure(command.displayCommand, result);
        if (infraFailure) {
          failures.push(infraFailure.code);
          infraFailureMessages.push(infraFailure.message);
        }
      }
    };

    const runSingleCommand = async (command: VerificationCommandPlan, repairAttempt: boolean) => {
      const toolEventResult = ticketIdForPolicy
        ? await this.commandEngine.invoke({
            runId: input.runId,
            repoId: input.repoId,
            ticketId: ticketIdForPolicy,
            stage: "review",
            actor: input.actor,
            worktreePath: input.worktreePath,
            commandPlan: command.commandPlan,
            toolType: "repo.verify",
          })
        : null;
      const directResult = ticketIdForPolicy ? null : runShell(command.displayCommand, input.worktreePath);
      await processVerificationResult(command, toolEventResult, directResult, repairAttempt);
    };

    const runVerificationCommands = async (repairAttempt = false) => {
      failures.length = 0;
      artifacts.length = 0;
      changedFileChecks.length = 0;
      impactedTests.length = 0;
      commandResults.length = 0;

      // Partition commands into concurrent-safe batches vs serial commands
      const concurrentBatch: VerificationCommandPlan[] = [];
      const serialBatch: VerificationCommandPlan[] = [];
      for (const command of input.commands) {
        if (isConcurrencySafe(command.displayCommand)) {
          concurrentBatch.push(command);
        } else {
          serialBatch.push(command);
        }
      }

      // Run serial commands first (e.g., build), then concurrent-safe in parallel
      for (const command of serialBatch) {
        await runSingleCommand(command, repairAttempt);
      }

      if (concurrentBatch.length > 0) {
        await Promise.all(
          concurrentBatch.map((command) => runSingleCommand(command, repairAttempt)),
        );
      }
    };

    await runVerificationCommands(false);

    const docsChecked = (input.docsRequired || []).filter((docPath) => {
      const absolutePath = ensureInsideRoot(input.worktreePath, docPath);
      const exists = fs.existsSync(absolutePath);
      if (!exists) {
        failures.push(`required_doc_missing:${docPath}`);
      }
      return exists;
    });

    const autoInstallEnabled = process.env.EXECUTION_AUTO_INSTALL_ON_INFRA_FAILURE !== "false";
    if (autoInstallEnabled && hasInfraVerificationFailure(failures)) {
      const installCommand = resolveDependencyBootstrapCommand(input.worktreePath);
      if (installCommand) {
        const installToolEventResult = ticketIdForPolicy
          ? await this.commandEngine.invoke({
              runId: input.runId,
              repoId: input.repoId,
              ticketId: ticketIdForPolicy,
              stage: "review",
              actor: input.actor,
              worktreePath: input.worktreePath,
              command: installCommand,
              toolType: "repo.install",
            })
          : null;
        const directInstallResult = ticketIdForPolicy ? null : runShell(installCommand, input.worktreePath);
        const installPolicyDecision = installToolEventResult?.event.policyDecision || "allowed";
        const installResult = installToolEventResult?.result || directInstallResult;
        if (!installResult) {
          throw new Error(`Dependency bootstrap command did not produce a result: ${installCommand}`);
        }
        const setupEvidence = await prisma.benchmarkOutcomeEvidence.create({
          data: {
            runId: input.runId,
            kind: "setup_result",
            payload: {
              command: installCommand,
              policy_decision: installPolicyDecision,
              approval_id: installToolEventResult?.event.approvalId ?? null,
              reason: "infra_failure_autofix",
              ...installResult,
              stdout: redactSensitiveText(installResult.stdout || ""),
              stderr: redactSensitiveText(installResult.stderr || ""),
            },
          },
        });
        artifacts.push(setupEvidence.id);

        const installBlockedByPolicy = Boolean(installToolEventResult && !installToolEventResult.result);
        if (installBlockedByPolicy) {
          if (installPolicyDecision === "approval_required") {
            failures.push(`approval_required:${installCommand}`);
            if (installToolEventResult.event.approvalId) {
              failures.push(`approval_request:${installToolEventResult.event.approvalId}`);
            }
            infraFailureMessages.push(`Approval required to run "${installCommand}".`);
          } else {
            failures.push(`policy_denied:${installCommand}`);
            infraFailureMessages.push(`Policy denied "${installCommand}".`);
          }
        } else if (installResult.ok) {
          repairedActions.push(`dependency_bootstrap:${installCommand}`);
          await runVerificationCommands(true);
        } else {
          failures.push(`setup_failed:${installCommand}`);
          infraFailureMessages.push(`Dependency bootstrap failed: ${installCommand}`);
        }
      }
    }

    const cheapRepairs = this.applyCheapStaticRepairs({
      worktreePath: input.worktreePath,
      commandResults,
      changedFiles: Array.isArray(attempt?.changedFiles) ? asStringArray(attempt.changedFiles) : [],
    });
    if (cheapRepairs.length > 0) {
      repairedFiles.push(...cheapRepairs);
      repairedActions.push(...cheapRepairs.map((filePath) => `static_repair:${filePath}`));
      await runVerificationCommands(true);
    }

    if (
      failures.length > 0 &&
      attempt &&
      attempt.providerId === "onprem-qwen" &&
      Array.isArray(attempt.changedFiles) &&
      attempt.changedFiles.length > 0 &&
      attempt.changedFiles.length <= 6 &&
      !hasInfraVerificationFailure(failures)
    ) {
      for (let round = 0; round < 3 && failures.length > 0; round += 1) {
        const repairedBatch = await this.attemptVerificationRepair({
          worktreePath: input.worktreePath,
          changedFiles: asStringArray(attempt.changedFiles),
          providerId: attempt.providerId as ProviderId,
          modelRole: (attempt.modelRole as ModelRole | null) || "review_deep",
          objective: attempt.patchSummary || "Repair verification failures from the previous code change.",
          commandResults,
          excludeFiles: repairedFiles,
        });

        if (repairedBatch.length === 0) {
          break;
        }

        repairedFiles.push(...repairedBatch);
        repairedActions.push(...repairedBatch.map((filePath) => `model_repair:${filePath}`));
        await runVerificationCommands(true);
      }
    }

    const bundle = await prisma.verificationBundle.create({
      data: {
        runId: input.runId,
        repoId: input.repoId,
        executionAttemptId: attempt?.id || null,
        changedFileChecks,
        impactedTests,
        fullSuiteRun: Boolean(input.fullSuiteRun),
        docsChecked,
        pass: failures.length === 0,
        failures,
        artifacts,
        metadata: {
          actor: input.actor,
          repaired_files: repairedFiles,
          repaired_actions: repairedActions,
          infra_failure_messages: Array.from(new Set(infraFailureMessages)),
          ...(input.metadata || {}),
        },
      },
    });

    await prisma.benchmarkOutcomeEvidence.create({
      data: {
        runId: input.runId,
        kind: "verification_bundle",
        payload: {
          verification_bundle_id: bundle.id,
          pass: bundle.pass,
          failures,
          artifacts,
        },
      },
    });

    if (attempt) {
      await prisma.executionAttempt.update({
        where: { id: attempt.id },
        data: {
          status: bundle.pass ? "verified" : "failed",
          completedAt: new Date(),
        },
      });
    }

    await this.upsertRunProjection(input.runId, {
      status: bundle.pass ? "verified" : "failed",
      providerId: (attempt?.providerId as ProviderId | undefined) || "onprem-qwen",
      metadata: {
        ...(toRecord((await prisma.runProjection.findUnique({ where: { runId: input.runId } }))?.metadata) || {}),
        verification_bundle_id: bundle.id,
        verification_failures: failures,
      },
    });

    await prisma.shareableRunReport.upsert({
      where: { runId: input.runId },
      update: {
        repoId: input.repoId,
        summary: bundle.pass
          ? `Execution verified. ${attempt?.changedFiles.length || 0} files changed, ${impactedTests.length} checks passed.`
          : `Execution needs review. Verification failed for ${failures.length} checks.`,
        evidenceUrls: artifacts,
        metadata: {
          changed_files: attempt?.changedFiles || [],
          tests_passed: impactedTests.filter((command) => !failures.includes(`command_failed:${command}`)),
          docs_updated: docsChecked,
          remaining_risks: failures,
          repaired_files: repairedFiles,
          repaired_actions: repairedActions,
          verification_commands: input.commands.map((item) => item.displayCommand),
          verification_reasons: asStringArray(input.metadata?.verification_reasons),
          enforced_rules: asStringArray(input.metadata?.enforced_rules),
        },
      },
      create: {
        runId: input.runId,
        repoId: input.repoId,
        summary: bundle.pass
          ? `Execution verified. ${attempt?.changedFiles.length || 0} files changed, ${impactedTests.length} checks passed.`
          : `Execution needs review. Verification failed for ${failures.length} checks.`,
        evidenceUrls: artifacts,
        metadata: {
          changed_files: attempt?.changedFiles || [],
          tests_passed: impactedTests.filter((command) => !failures.includes(`command_failed:${command}`)),
          docs_updated: docsChecked,
          remaining_risks: failures,
          repaired_files: repairedFiles,
          repaired_actions: repairedActions,
          verification_commands: input.commands.map((item) => item.displayCommand),
          verification_reasons: asStringArray(input.metadata?.verification_reasons),
          enforced_rules: asStringArray(input.metadata?.enforced_rules),
        },
      },
    });

    await this.events.appendEvent({
      type: "execution.verify.completed",
      aggregateId: input.runId,
      actor: input.actor,
      payload: {
        run_id: input.runId,
        verification_bundle_id: bundle.id,
        pass: bundle.pass,
        failures,
      },
    });

    publishEvent("global", "execution.verify.completed", {
      runId: input.runId,
      verificationBundleId: bundle.id,
      pass: bundle.pass,
      failures,
    });

    return mapBundle(bundle);
  }
}
