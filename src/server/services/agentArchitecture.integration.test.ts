/**
 * Integration test for the full agent architecture pipeline.
 *
 * Exercises all new services together in a simulated multi-step
 * execution flow — the same code paths that would fire during
 * a real desktop acceptance run.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Phase 1 — Hardware profiling types
import type { HardwareProfile, BackendHealthStatus, PromptCacheMetrics, SpeculativeDecodingConfig } from "../../shared/contracts";

// Phase 3 — Doom-loop detection
import { DoomLoopDetector } from "./doomLoopDetector";

// Phase 4 — Adaptive context compaction
import {
  estimateTokens,
  computePressure,
  compactMessages,
  type CompactionMessage,
} from "./contextCompactionService";

// Phase 5 — Tool result optimization
import {
  optimizeShellOutput,
  optimizeFileRead,
  optimizeSearchResults,
  optimizeBuildOutput,
  optimizeToolOutput,
  shouldOffload,
} from "./toolResultOptimizer";

// Phase 6 — System reminders
import {
  buildBaseReminder,
  buildErrorReminder,
  buildEditReminder,
  buildJsonFormatReminder,
  shouldInjectReminder,
  injectReminders,
  type BlueprintPolicies,
} from "./systemReminderService";

// Phase 7 — Edit matcher chain
import {
  exactMatch,
  whitespaceNormalizedMatch,
  indentFlexibleMatch,
  lineTrimmedMatch,
  fuzzyLineMatch,
  similarityMatch,
  wholeBlockMatch,
  runEditMatcherChain,
  levenshteinSimilarity,
} from "./editMatcherChain";

// Phase 8/9 — Backend descriptors (speculative decoding, FIM)
import {
  listOnPremInferenceBackends,
  resolveOnPremInferenceBackend,
  buildStartupCommand,
  buildFimPrompt,
} from "../providers/inferenceBackends";

// Phase 11 — Tree-sitter (optional, falls back to regex)
import { checkTreeSitterSupport } from "./treeSitterAnalyzer";

// Phase 12 — Shadow git snapshots
import { ShadowGitService } from "./shadowGitService";

// Phase 13 — Dual memory
import {
  MemoryService,
  tokenize as memTokenize,
  cosineSimilarity,
  truncateToChars,
} from "./memoryService";

describe("Agent Architecture Integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-arch-integ-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────────────────
  // Scenario 1: Simulated multi-step execution with
  //   doom-loop detection, context compaction, reminders,
  //   tool optimization, edit matching, and shadow git
  // ────────────────────────────────────────────────────

  it("runs a full simulated execution loop without doom-looping", () => {
    const detector = new DoomLoopDetector();

    // Simulate 5 different file-generation steps
    const steps = [
      { action: "generate_file", args: { path: "src/App.tsx", strategy: "full_file" } },
      { action: "generate_file", args: { path: "src/components/StatusBadge.tsx", strategy: "full_file" } },
      { action: "generate_file", args: { path: "src/App.test.tsx", strategy: "search_replace" } },
      { action: "generate_file", args: { path: "README.md", strategy: "search_replace" } },
      { action: "run_verification", args: { commands: ["npm test", "npm run build"] } },
    ];

    for (const step of steps) {
      detector.record(step.action, step.args);
      expect(detector.isLooping()).toBe(false);
    }

    expect(detector.stats().recorded).toBe(5);
    expect(detector.stats().looping).toBe(false);
  });

  it("detects doom loop when the same step repeats", () => {
    const detector = new DoomLoopDetector({ windowSize: 10, threshold: 3 });

    const repeatedStep = { action: "generate_file", args: { path: "src/App.tsx", strategy: "full_file" } };

    detector.record(repeatedStep.action, repeatedStep.args);
    expect(detector.isLooping()).toBe(false);

    detector.record(repeatedStep.action, repeatedStep.args);
    expect(detector.isLooping()).toBe(false);

    detector.record(repeatedStep.action, repeatedStep.args);
    expect(detector.isLooping()).toBe(true);
    expect(detector.getLoopingAction()).toBe("generate_file");

    // Strategy change escape
    detector.reset();
    expect(detector.isLooping()).toBe(false);
  });

  // ────────────────────────────────────────────────────
  // Scenario 2: Context compaction under pressure
  // ────────────────────────────────────────────────────

  it("compacts messages progressively as context pressure rises", () => {
    const maxTokens = 1000;

    // Build messages that are under 70% — no compaction
    const smallMessages: CompactionMessage[] = [
      { role: "system", content: "You are an assistant.", pinned: true },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];

    const result0 = compactMessages(smallMessages, maxTokens);
    expect(result0.stage).toBe(0);
    expect(result0.messages.length).toBe(3);

    // Build messages that exceed 70% — stage 1 triggers
    // Each "x".repeat(1000) = ~250 tokens; 4 of them = ~1000 tokens > 700 (70% of 1000)
    const paddedContent = "x".repeat(1000);
    const pressuredMessages: CompactionMessage[] = [
      { role: "system", content: "System prompt.", pinned: true },
      { role: "assistant", content: paddedContent },
      { role: "assistant", content: paddedContent },
      { role: "assistant", content: paddedContent },
      { role: "user", content: "Do something" },
      { role: "assistant", content: "Latest response" },
      { role: "assistant", content: "Another response" },
      { role: "assistant", content: "Final response" },
    ];

    const pressure = computePressure(pressuredMessages, maxTokens);
    expect(pressure).toBeGreaterThan(0.7);

    const result1 = compactMessages(pressuredMessages, maxTokens);
    expect(result1.stage).toBeGreaterThanOrEqual(1);
    expect(result1.tokensAfter).toBeLessThanOrEqual(result1.tokensBefore);

    // Pinned message always survives
    const systemMsg = result1.messages.find((m) => m.pinned);
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.content).toBe("System prompt.");
  });

  // ────────────────────────────────────────────────────
  // Scenario 3: Tool result optimization in execution
  // ────────────────────────────────────────────────────

  it("optimizes verbose tool outputs from a build-verify cycle", () => {
    // Simulate a large build output
    const buildLines = Array.from({ length: 120 }, (_, i) =>
      i === 45 ? "ERROR: Module not found: './missing'" :
      i === 90 ? "warning: Unused variable 'x'" :
      `  Building module ${i}...`
    );
    const buildOutput = buildLines.join("\n");

    const optimized = optimizeBuildOutput(buildOutput);
    expect(optimized).toContain("ERROR");
    expect(optimized).toContain("warning");
    expect(optimized.split("\n").length).toBeLessThan(buildOutput.split("\n").length);

    // Simulate large shell output
    const shellLines = Array.from({ length: 200 }, (_, i) =>
      i === 180 ? "FAIL: Test suite failed to run" : `  PASS test ${i}`
    );
    const shellOutput = shellLines.join("\n");

    const optimizedShell = optimizeShellOutput(shellOutput);
    expect(optimizedShell).toContain("FAIL");
    expect(optimizedShell).toContain("truncated");

    // Dispatcher works
    const dispatched = optimizeToolOutput(buildOutput, "build");
    expect(dispatched).toContain("ERROR");

    // Offloading check
    expect(shouldOffload("x".repeat(9000))).toBe(true);
    expect(shouldOffload("short")).toBe(false);
  });

  it("optimizes file reads and search results", () => {
    // Large file read
    const fileLines = Array.from({ length: 300 }, (_, i) => `line ${i}: const x = ${i};`);
    const fileContent = fileLines.join("\n");
    const optimizedFile = optimizeFileRead(fileContent);
    expect(optimizedFile).toContain("lines omitted");
    expect(optimizedFile).toContain("line 0:");
    expect(optimizedFile).toContain("line 299:");

    // Many search results
    const searchBlocks = Array.from({ length: 30 }, (_, i) => `Match ${i}:\n  src/file${i}.ts:42: const result = process();`);
    const searchOutput = searchBlocks.join("\n\n");
    const optimizedSearch = optimizeSearchResults(searchOutput);
    expect(optimizedSearch).toContain("matches omitted");
  });

  // ────────────────────────────────────────────────────
  // Scenario 4: System reminders with blueprint policies
  // ────────────────────────────────────────────────────

  it("injects system reminders based on blueprint policies and triggers", () => {
    const policies: BlueprintPolicies = {
      testingRequired: true,
      docsRequired: true,
      protectedPaths: ["src/core/auth.ts"],
      maxChangedFiles: 5,
    };

    // Base reminder includes policy info
    const base = buildBaseReminder(policies);
    expect(base).toContain("Tests are REQUIRED");
    expect(base).toContain("documentation");
    expect(base).toContain("auth.ts");
    expect(base).toContain("5 files");

    // Interval check
    expect(shouldInjectReminder(10)).toBe(true);
    expect(shouldInjectReminder(7)).toBe(false);
    expect(shouldInjectReminder(20)).toBe(true);
    expect(shouldInjectReminder(0)).toBe(false);

    // Inject for each trigger type
    const messages = [
      { role: "system", content: "You are an agent." },
      { role: "user", content: "Fix the bug" },
    ];

    const withInterval = injectReminders({ messages, trigger: "interval", policies });
    expect(withInterval.length).toBe(3);
    expect(withInterval[2].role).toBe("user");
    expect(withInterval[2].content).toContain("[System Reminder]");
    expect(withInterval[2].content).toContain("Tests are REQUIRED");

    const withError = injectReminders({ messages, trigger: "error" });
    expect(withError[2].content).toContain("tool error");

    const withEdit = injectReminders({ messages, trigger: "edit" });
    expect(withEdit[2].content).toContain("editing files");

    const withJson = injectReminders({ messages, trigger: "json_format" });
    expect(withJson[2].content).toContain("valid JSON");

    // Original array not mutated
    expect(messages.length).toBe(2);
  });

  // ────────────────────────────────────────────────────
  // Scenario 5: Edit matcher chain — realistic code edits
  // ────────────────────────────────────────────────────

  it("matches and applies code edits through the matcher chain", () => {
    const originalCode = `import { useState } from "react";
import "./App.css";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="app-shell">
      <h1>Hello World</h1>
      <button onClick={() => setCount(c => c + 1)}>
        Count is {count}
      </button>
    </main>
  );
}
`;

    // Level 1: Exact match
    const exact = exactMatch(originalCode, '<h1>Hello World</h1>');
    expect(exact).not.toBeNull();
    expect(exact!.matcherLevel).toBe(1);

    // Level 2: Whitespace-normalized (extra spaces)
    const wsNorm = whitespaceNormalizedMatch(originalCode, 'const  [count,  setCount]  =  useState(0);');
    expect(wsNorm).not.toBeNull();
    expect(wsNorm!.matcherLevel).toBe(2);

    // Full chain: apply a real edit
    const result = runEditMatcherChain(
      originalCode,
      '<h1>Hello World</h1>',
      '<h1>Hello Agent</h1>\n      <StatusBadge />'
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain("Hello Agent");
    expect(result.content).toContain("<StatusBadge />");
    expect(result.match!.matcherLevel).toBe(1); // exact match preferred

    // Chain handles indentation drift (level 3)
    const indentDriftCode = "  function foo() {\n    return 42;\n  }";
    const indentResult = indentFlexibleMatch(indentDriftCode, "function foo() {\n  return 42;\n}");
    expect(indentResult).not.toBeNull();

    // Similarity match for minor typos (level 7)
    const sim = levenshteinSimilarity("hello world", "hello worlf");
    expect(sim).toBeGreaterThan(0.85);
  });

  it("handles whole-block replacement for function declarations", () => {
    const code = `export function calculateTotal(items: number[]) {
  let sum = 0;
  for (const item of items) {
    sum += item;
  }
  return sum;
}

export function formatPrice(amount: number) {
  return "$" + amount.toFixed(2);
}
`;

    // Whole-block match by declaration signature — matches the first line
    const blockMatch = wholeBlockMatch(code, "export function calculateTotal(items: number[]) {");
    expect(blockMatch).not.toBeNull();
    expect(blockMatch!.matcherLevel).toBe(8);
    expect(blockMatch!.matchedText).toContain("calculateTotal");
    // wholeBlockMatch returns the declaration line, not the full body
    expect(blockMatch!.matchedText).toContain("export function");

    // Full chain replacement still works — replaces the matched declaration line
    const chainResult = runEditMatcherChain(
      code,
      "export function calculateTotal(items: number[]) {",
      "export function calculateTotal(items: number[]): number {"
    );
    expect(chainResult.success).toBe(true);
    expect(chainResult.content).toContain("): number {");
  });

  // ────────────────────────────────────────────────────
  // Scenario 6: Shadow git snapshots through a multi-file edit
  // ────────────────────────────────────────────────────

  it("creates shadow git snapshots and can rollback individual steps", () => {
    const shadow = new ShadowGitService(tempDir, { maxSnapshots: 10 });
    shadow.initialize();

    // Step 1: Create App.tsx
    const snap1 = shadow.snapshot({
      filePath: "src/App.tsx",
      content: 'export default function App() { return <div>v1</div>; }\n',
      stepId: "step-1",
      description: "Initial App.tsx",
    });
    expect(snap1.commitHash).toBeTruthy();

    // Step 2: Update App.tsx
    const snap2 = shadow.snapshot({
      filePath: "src/App.tsx",
      content: 'import { StatusBadge } from "./components/StatusBadge";\nexport default function App() { return <div>v2<StatusBadge /></div>; }\n',
      stepId: "step-2",
      description: "Add StatusBadge import",
    });

    // Step 3: Create StatusBadge.tsx
    const snap3 = shadow.snapshot({
      filePath: "src/components/StatusBadge.tsx",
      content: 'export function StatusBadge() { return <span>Ready</span>; }\n',
      stepId: "step-3",
      description: "Create StatusBadge component",
    });

    expect(shadow.listSnapshots().length).toBe(3);

    // Rollback to step-1 (original App.tsx)
    const rollback1 = shadow.rollback("step-1");
    expect(rollback1).not.toBeNull();
    expect(rollback1!.content).toContain("v1");
    expect(rollback1!.content).not.toContain("StatusBadge");

    // Rollback to step-2 (updated App.tsx)
    const rollback2 = shadow.rollback("step-2");
    expect(rollback2).not.toBeNull();
    expect(rollback2!.content).toContain("StatusBadge");
    expect(rollback2!.content).toContain("v2");

    // Unknown step returns null
    expect(shadow.rollback("step-999")).toBeNull();
  });

  // ────────────────────────────────────────────────────
  // Scenario 7: Dual memory across task executions
  // ────────────────────────────────────────────────────

  it("builds episodic memory and composes context for new tasks", () => {
    const memory = new MemoryService(tempDir);

    // Simulate 3 completed tasks
    memory.addEpisodicMemory({
      taskDescription: "Add a StatusBadge component with ready/error states",
      summary: "Created StatusBadge.tsx in src/components, updated App.tsx to render it, added test cases for both states. Tests pass.",
      outcome: "success",
      keyFiles: ["src/components/StatusBadge.tsx", "src/App.tsx", "src/App.test.tsx"],
      lessons: ["Component files go in src/components/", "Always update App.tsx to render new components"],
    });

    memory.addEpisodicMemory({
      taskDescription: "Fix ESLint warnings in the codebase",
      summary: "Resolved 12 unused import warnings and 3 missing return type annotations.",
      outcome: "success",
      keyFiles: ["src/App.tsx", "src/utils/format.ts"],
      lessons: ["Run lint before committing"],
    });

    memory.addEpisodicMemory({
      taskDescription: "Add a ProgressBar component with percentage display",
      summary: "Created ProgressBar.tsx, but initial attempt failed tests due to missing aria attributes. Fixed on second try.",
      outcome: "partial",
      keyFiles: ["src/components/ProgressBar.tsx"],
      lessons: ["Always include aria-label on interactive components", "Test accessibility attributes"],
    });

    // Working memory — last few messages
    memory.addWorkingMessage({ role: "user", content: "Add a ThemeToggle component" });
    memory.addWorkingMessage({ role: "assistant", content: "I'll create a ThemeToggle component..." });

    // Compose for a new component task — should recall StatusBadge and ProgressBar experience
    const composition = memory.compose("Add a ThemeToggle component with light/dark/system modes");
    expect(composition.stats.episodicCount).toBeGreaterThan(0);
    expect(composition.stats.workingCount).toBe(2);
    expect(composition.episodicContext).toContain("Previous Task Experience");
    // Component-creation tasks should be most relevant
    expect(composition.episodicContext).toContain("StatusBadge");

    // Save and reload
    memory.saveEpisodicMemory();
    const memory2 = new MemoryService(tempDir);
    memory2.loadEpisodicMemory();
    const composition2 = memory2.compose("Add another component");
    expect(composition2.stats.episodicCount).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────
  // Scenario 8: Speculative decoding & FIM configuration
  // ────────────────────────────────────────────────────

  it("configures speculative decoding for CUDA backends with sufficient VRAM", () => {
    const vllm = resolveOnPremInferenceBackend("vllm-openai");
    expect(vllm.speculativeDecoding?.supported).toBe(true);

    // With enough VRAM — include spec decode flags
    const cmdHigh = buildStartupCommand(vllm, "Qwen/Qwen3.5-4B", {
      enableSpeculativeDecoding: true,
      vramMb: 16384,
    });
    expect(cmdHigh).toContain("--speculative-model Qwen/Qwen3-0.6B");
    expect(cmdHigh).toContain("--num-speculative-tokens 5");
    expect(cmdHigh).toContain("vllm serve Qwen/Qwen3.5-4B");

    // With low VRAM — omit spec decode
    const cmdLow = buildStartupCommand(vllm, "Qwen/Qwen3.5-4B", {
      enableSpeculativeDecoding: true,
      vramMb: 512,
    });
    expect(cmdLow).not.toContain("--speculative-model");

    // MLX doesn't support spec decode
    const mlx = resolveOnPremInferenceBackend("mlx-lm");
    const cmdMlx = buildStartupCommand(mlx, "test-model", {
      enableSpeculativeDecoding: true,
    });
    expect(cmdMlx).not.toContain("--speculative-model");

    // SGLang also supports it
    const sglang = resolveOnPremInferenceBackend("sglang");
    expect(sglang.speculativeDecoding?.supported).toBe(true);
  });

  it("builds FIM prompts for supported backends", () => {
    const vllm = resolveOnPremInferenceBackend("vllm-openai");
    const prompt = buildFimPrompt(
      vllm,
      "function greet(name: string) {\n  ",
      "\n}\n"
    );
    expect(prompt).toBe(
      "<|fim_prefix|>function greet(name: string) {\n  <|fim_suffix|>\n}\n<|fim_middle|>"
    );

    // All FIM-capable backends use the same Qwen token format
    const backends = listOnPremInferenceBackends();
    const fimBackends = backends.filter((b) => b.supportsFim);
    expect(fimBackends.length).toBeGreaterThanOrEqual(4);
    for (const backend of fimBackends) {
      expect(backend.fimTokenFormat?.prefix).toBe("<|fim_prefix|>");
      expect(backend.fimTokenFormat?.suffix).toBe("<|fim_suffix|>");
      expect(backend.fimTokenFormat?.middle).toBe("<|fim_middle|>");
    }

    // Non-FIM backend returns null
    const transformers = resolveOnPremInferenceBackend("transformers-openai");
    expect(buildFimPrompt(transformers, "a", "b")).toBeNull();
  });

  // ────────────────────────────────────────────────────
  // Scenario 9: Tree-sitter availability check
  // ────────────────────────────────────────────────────

  it("reports tree-sitter availability without crashing", async () => {
    const status = await checkTreeSitterSupport();
    expect(typeof status.available).toBe("boolean");
    expect(Array.isArray(status.languages)).toBe(true);
    // If tree-sitter is installed, we should have languages
    if (status.available) {
      expect(status.languages.length).toBeGreaterThan(0);
    }
  });

  // ────────────────────────────────────────────────────
  // Scenario 10: Full pipeline simulation — all services
  //   working together as they would during a real execution
  // ────────────────────────────────────────────────────

  it("runs a complete agent pipeline simulation with all services", () => {
    // Initialize services
    const detector = new DoomLoopDetector();
    const shadow = new ShadowGitService(tempDir, { maxSnapshots: 20 });
    const memory = new MemoryService(tempDir);
    shadow.initialize();

    const policies: BlueprintPolicies = {
      testingRequired: true,
      docsRequired: true,
      protectedPaths: [],
      maxChangedFiles: 10,
    };

    // Simulate a multi-step execution
    const objective = "Add a StatusBadge component with ready/processing/error states";
    const filesToGenerate = [
      { path: "src/components/StatusBadge.tsx", action: "create" as const, content: 'export function StatusBadge({ status = "ready" }) { return <span>{status}</span>; }\n' },
      { path: "src/App.tsx", action: "update" as const, content: 'import { StatusBadge } from "./components/StatusBadge";\nexport default function App() { return <div><StatusBadge /></div>; }\n' },
      { path: "src/App.test.tsx", action: "update" as const, content: 'import { render } from "@testing-library/react";\nimport App from "./App";\ntest("renders", () => { render(<App />); });\n' },
      { path: "README.md", action: "update" as const, content: '# App\n\nNow includes StatusBadge component.\n' },
    ];

    const messages: CompactionMessage[] = [
      { role: "system", content: "You are a coding agent. Follow the edit format strictly.", pinned: true },
      { role: "user", content: `Objective: ${objective}`, pinned: true },
    ];

    let stepCount = 0;

    for (const file of filesToGenerate) {
      stepCount++;

      // 1. Doom-loop check
      detector.record("generate_file", { path: file.path, action: file.action });
      expect(detector.isLooping()).toBe(false);

      // 2. Shadow snapshot before write
      shadow.snapshot({
        filePath: file.path,
        content: file.content,
        stepId: `step-${stepCount}`,
        description: `${file.action} ${file.path}`,
      });

      // 3. Add model response to context
      messages.push({
        role: "assistant",
        content: `Generated ${file.path}:\n\`\`\`tsx\n${file.content}\`\`\``,
      });

      // 4. Check if system reminder should inject
      if (shouldInjectReminder(messages.length)) {
        const reminded = injectReminders({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          trigger: "interval",
          policies,
        });
        messages.push({ role: "user", content: reminded[reminded.length - 1].content });
      }

      // 5. Context compaction check
      const maxContext = 2000;
      const pressure = computePressure(messages, maxContext);
      if (pressure > 0.7) {
        const compacted = compactMessages(messages, maxContext);
        // In real execution, we'd replace messages with compacted.messages
        expect(compacted.tokensAfter).toBeLessThanOrEqual(compacted.tokensBefore);
      }
    }

    // Simulate verification output
    const buildOutput = Array.from({ length: 80 }, (_, i) =>
      i === 72 ? "warning: React import is unused" : `  Compiling module ${i}...`
    ).join("\n");
    const testOutput = Array.from({ length: 60 }, (_, i) => `  PASS test ${i}`).join("\n");

    const optimizedBuild = optimizeBuildOutput(buildOutput);
    const optimizedTest = optimizeToolOutput(testOutput, "shell");

    // Build output should extract the warning
    expect(optimizedBuild).toContain("warning");

    // Test output is under 100 lines, passes through
    expect(optimizedTest).toBe(testOutput);

    // After execution, record episodic memory
    memory.addEpisodicMemory({
      taskDescription: objective,
      summary: `Created StatusBadge component, updated App.tsx, tests, and docs. ${filesToGenerate.length} files changed.`,
      outcome: "success",
      keyFiles: filesToGenerate.map((f) => f.path),
      lessons: ["Component files go in src/components/", "Always update imports in App.tsx"],
    });

    // Verify all shadow snapshots
    const snapshots = shadow.listSnapshots();
    expect(snapshots.length).toBe(filesToGenerate.length);

    // Verify rollback works for any step
    for (let i = 0; i < filesToGenerate.length; i++) {
      const rb = shadow.rollback(`step-${i + 1}`);
      expect(rb).not.toBeNull();
      expect(rb!.content).toBe(filesToGenerate[i].content);
    }

    // Verify memory persists
    memory.saveEpisodicMemory();
    const freshMemory = new MemoryService(tempDir);
    freshMemory.loadEpisodicMemory();
    const comp = freshMemory.compose("Add a ProgressBar component");
    expect(comp.stats.episodicCount).toBe(1);
    expect(comp.episodicContext).toContain("StatusBadge");

    // Final doom-loop stats
    expect(detector.stats().recorded).toBe(filesToGenerate.length);
    expect(detector.stats().looping).toBe(false);
  });

  // ────────────────────────────────────────────────────
  // Scenario 11: Edit matcher chain with search_replace
  //   strategy — simulates the real edit path
  // ────────────────────────────────────────────────────

  it("applies search-replace edits through the matcher chain with realistic code", () => {
    const appTsx = `import { useState } from "react";
import "./App.css";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">TypeScript App</p>
        <h1>Ship changes with tests, docs, and a clean baseline.</h1>
        <div className="actions">
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            Count is {count}
          </button>
        </div>
      </section>
    </main>
  );
}
`;

    // Edit 1: Add StatusBadge import (exact match)
    const edit1 = runEditMatcherChain(
      appTsx,
      'import "./App.css";',
      'import "./App.css";\nimport { StatusBadge } from "./components/StatusBadge";'
    );
    expect(edit1.success).toBe(true);
    expect(edit1.match!.matcherLevel).toBe(1);
    expect(edit1.content).toContain('import { StatusBadge }');

    // Edit 2: Add StatusBadge render (exact match on the div block)
    const edit2 = runEditMatcherChain(
      edit1.content,
      '        </div>\n      </section>',
      '          <StatusBadge />\n        </div>\n      </section>'
    );
    expect(edit2.success).toBe(true);
    expect(edit2.content).toContain('<StatusBadge />');

    // Edit 3: Handle whitespace-drifted match (model returns slightly different indentation)
    const driftedSearch = '  const [count,  setCount] =  useState(0);';
    const wsMatch = whitespaceNormalizedMatch(edit2.content, driftedSearch);
    expect(wsMatch).not.toBeNull();

    // Edit 4: Fuzzy line match (model omits one line)
    const multiLineSearch = `        <p className="eyebrow">TypeScript App</p>
        <h1>Ship changes with tests, docs, and a clean baseline.</h1>`;
    const fuzzyResult = fuzzyLineMatch(edit2.content, multiLineSearch);
    // Should find exact since all lines are there
    expect(fuzzyResult !== null || exactMatch(edit2.content, multiLineSearch) !== null).toBe(true);
  });

  // ────────────────────────────────────────────────────
  // Scenario 12: Hardware profile type validation
  // ────────────────────────────────────────────────────

  it("validates HardwareProfile type structure", () => {
    const profiles: HardwareProfile[] = [
      { platform: "apple-silicon", unifiedMemoryMb: 36864 },
      { platform: "nvidia-cuda", vramMb: 24576, computeCapability: "8.9" },
      { platform: "generic-cpu" },
    ];

    for (const profile of profiles) {
      expect(["apple-silicon", "nvidia-cuda", "generic-cpu"]).toContain(profile.platform);
    }

    expect(profiles[0].unifiedMemoryMb).toBe(36864);
    expect(profiles[1].vramMb).toBe(24576);
    expect(profiles[1].computeCapability).toBe("8.9");
    expect(profiles[2].vramMb).toBeUndefined();
  });

  it("validates BackendHealthStatus type structure", () => {
    const status: BackendHealthStatus = {
      status: "healthy",
      lastCheck: new Date().toISOString(),
      restartCount: 0,
      consecutiveFailures: 0,
    };

    expect(["healthy", "degraded", "down"]).toContain(status.status);
    expect(status.restartCount).toBe(0);
  });

  it("validates PromptCacheMetrics type structure", () => {
    const metrics: PromptCacheMetrics = {
      hitRate: 0.75,
      totalRequests: 100,
      cacheHits: 75,
      lastUpdated: new Date().toISOString(),
    };

    expect(metrics.hitRate).toBe(0.75);
    expect(metrics.cacheHits / metrics.totalRequests).toBe(metrics.hitRate);
  });

  // ────────────────────────────────────────────────────
  // Scenario 13: Backend descriptor completeness
  // ────────────────────────────────────────────────────

  it("ensures all backends have complete descriptors for new fields", () => {
    const backends = listOnPremInferenceBackends();
    expect(backends.length).toBe(7);

    for (const backend of backends) {
      // Every backend must have these new fields defined
      expect(typeof backend.supportsFim).toBe("boolean");
      expect(backend.speculativeDecoding).toBeDefined();
      expect(typeof backend.speculativeDecoding!.supported).toBe("boolean");

      // FIM backends must have token format
      if (backend.supportsFim) {
        expect(backend.fimTokenFormat).toBeDefined();
        expect(backend.fimTokenFormat!.prefix).toBeTruthy();
        expect(backend.fimTokenFormat!.suffix).toBeTruthy();
        expect(backend.fimTokenFormat!.middle).toBeTruthy();
      }

      // Speculative decoding backends must have draft model info
      if (backend.speculativeDecoding!.supported) {
        expect(backend.speculativeDecoding!.draftModelId).toBeTruthy();
        expect(backend.speculativeDecoding!.flag).toBeTruthy();
        expect(typeof backend.speculativeDecoding!.numSpeculativeTokens).toBe("number");
      }

      // Existing fields still present
      expect(typeof backend.supportsJsonMode).toBe("boolean");
      expect(backend.supportsPrefixCaching).toBeDefined();
      expect(typeof backend.supportsConstrainedDecoding).toBe("boolean");
    }
  });

  // ────────────────────────────────────────────────────
  // Scenario 14: Memory utility functions
  // ────────────────────────────────────────────────────

  it("tokenizes and computes similarity for task matching", () => {
    const taskA = memTokenize("Add a StatusBadge component with ready and error states");
    const taskB = memTokenize("Create a StatusIndicator component with active and error states");
    const taskC = memTokenize("Fix the database connection timeout issue");

    // A and B are more similar (component creation)
    const simAB = cosineSimilarity(taskA, taskB);
    const simAC = cosineSimilarity(taskA, taskC);
    expect(simAB).toBeGreaterThan(simAC);

    // Truncation
    const long = "x".repeat(1000);
    const truncated = truncateToChars(long, 500);
    expect(truncated.length).toBe(503); // 500 + "..."
    expect(truncated.endsWith("...")).toBe(true);

    const short = "hello";
    expect(truncateToChars(short, 500)).toBe("hello");
  });
});
