export type MissionRunPhase = "starting" | "single_task_validation" | "parallel_running" | "draining" | "completed" | "error" | "stopped" | "idle";

export interface MissionChangeBrief {
  task_id: string;
  title: string;
  status: "success" | "active" | "failed";
  summary: string;
  patches_applied: number;
  token_total: number;
  worker_id: number | null;
  generated_at: string;
  files: string[];
}

export interface MissionStream {
  workstream: string;
  risk: "critical" | "warn" | "ok";
  queued: number;
  in_progress: number;
  blocked: number;
  failed: number;
  completed: number;
  top_task_id: string | null;
}

export interface MissionTaskCard {
  task_id: string;
  title: string;
  phase: string;
}

export interface TaskSpotlight {
  task_id: string;
  title: string;
  lifecycle: {
    current_phase: string;
    events: Array<{ timestamp: string; severity: string; message: string }>;
  };
  latest_transition_reason?: string;
  phase_durations?: Record<string, number>;
  latest_artifact?: {
    payload: any;
    markdown_summary: string;
    llm_output_count: number;
  };
  failure: { code?: string; error?: string };
}

export interface MissionTimelineEvent {
  id: string;
  phase: MissionRunPhase;
  severity: "INFO" | "WARNING" | "ERROR";
  kind?: string;
  timestamp: string;
  message: string;
  task_id?: string;
}

export interface AgentWorker {
  id: string;
  workerId: number;
  status: "active" | "idle" | "error" | "cooldown";
  currentTask: string | null;
  taskTitle: string | null;
  tokensUsed: number;
  tokensLimit: number;
  avgResponseTime: number;
  completedTasks: number;
  failedTasks: number;
  uptime: string;
  model: string;
  capabilities: string[];
  lastHeartbeat: string;
}

export interface CodePattern {
  id: string;
  name: string;
  description: string;
  occurrences: number;
  files: string[];
  confidence: number;
  suggestion: string;
  tags: string[];
  severity: "refactor" | "optimization" | "bug-prone" | "security";
}

export interface TelemetryDataPoint {
  time: string;
  w1: number;
  w2: number;
  w3: number;
  total: number;
}

export interface TaskCompletionPoint {
  hour: string;
  completed: number;
  failed: number;
}

export interface CodebaseFile {
  path: string;
  status: "modified" | "added" | "deleted" | "unchanged";
  lines: number;
  agent: string | null;
  taskId: string | null;
}

export interface ArtifactItem {
  id: string;
  taskId: string;
  type: "patch" | "diff" | "analysis" | "generated";
  filename: string;
  content: string;
  size: string;
  createdAt: string;
  status: "applied" | "pending" | "rejected";
  language: string;
}

export interface ConsoleLog {
  id: string;
  level: "info" | "warn" | "error" | "debug" | "success";
  timestamp: string;
  message: string;
  source: string;
  taskId?: string;
}

// ─── Change Briefs ──────────────────────────────────────────────────────────
export const mockChangeBriefs: MissionChangeBrief[] = [
  {
    task_id: "TSK-8821",
    title: "Implement Auth Middleware",
    status: "success",
    summary: "Successfully added JWT validation to all protected API routes. No issues detected in test run.",
    patches_applied: 4,
    token_total: 12450,
    worker_id: 2,
    generated_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    files: ["src/api/middleware/auth.ts", "src/api/routes/user.ts"],
  },
  {
    task_id: "TSK-8824",
    title: "Refactor Database Schema",
    status: "failed",
    summary: "[VERIFY_FAIL] Type mismatch in user relation. Model attempted to drop a required foreign key constraint.",
    patches_applied: 2,
    token_total: 18200,
    worker_id: 1,
    generated_at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    files: ["prisma/schema.prisma", "src/db/migrations/2023_01_01_init.sql"],
  },
  {
    task_id: "TSK-8825",
    title: "Optimize Image Loader",
    status: "active",
    summary: "Generating responsive image component with webp fallback support and lazy loading via intersection observer.",
    patches_applied: 0,
    token_total: 3400,
    worker_id: 3,
    generated_at: new Date(Date.now() - 1000 * 60 * 1).toISOString(),
    files: ["src/components/ImageLoader.tsx"],
  },
  {
    task_id: "TSK-8819",
    title: "Setup Connection Pooling",
    status: "failed",
    summary: "PostgreSQL pool configuration failed validation. Min connections exceeded max pool limit in staging env.",
    patches_applied: 1,
    token_total: 7800,
    worker_id: 1,
    generated_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    files: ["src/db/pool.ts", "config/database.yml"],
  },
  {
    task_id: "TSK-8818",
    title: "Add Rate Limiter",
    status: "success",
    summary: "Sliding window rate limiter implemented. 1000 req/min per API key, configurable per route via decorator.",
    patches_applied: 3,
    token_total: 9200,
    worker_id: 2,
    generated_at: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    files: ["src/api/middleware/rateLimit.ts", "src/api/decorators/limit.ts"],
  },
];

// ─── Streams ─────────────────────────────────────────────────────────────────
export const mockStreams: MissionStream[] = [
  {
    workstream: "Frontend UX",
    risk: "ok",
    queued: 5,
    in_progress: 2,
    blocked: 0,
    failed: 0,
    completed: 12,
    top_task_id: "TSK-8825",
  },
  {
    workstream: "Backend API",
    risk: "warn",
    queued: 12,
    in_progress: 3,
    blocked: 1,
    failed: 1,
    completed: 24,
    top_task_id: "TSK-8824",
  },
  {
    workstream: "Database Ops",
    risk: "critical",
    queued: 2,
    in_progress: 1,
    blocked: 3,
    failed: 2,
    completed: 4,
    top_task_id: "TSK-8819",
  },
];

// ─── Timeline ────────────────────────────────────────────────────────────────
export const mockTimeline: MissionTimelineEvent[] = [
  { id: "e1", phase: "starting", severity: "INFO", timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(), message: "Mission started with 3 workers." },
  { id: "e2", phase: "single_task_validation", severity: "INFO", timestamp: new Date(Date.now() - 1000 * 60 * 55).toISOString(), message: "Initial sanity checks passed." },
  { id: "e3", phase: "parallel_running", severity: "INFO", timestamp: new Date(Date.now() - 1000 * 60 * 50).toISOString(), message: "Switched to parallel execution mode." },
  { id: "e4", phase: "parallel_running", severity: "WARNING", timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), message: "Worker 1 experiencing high latency.", kind: "PERF" },
  { id: "e5", phase: "parallel_running", severity: "ERROR", task_id: "TSK-8824", timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), message: "Failed to apply patch due to merge conflict.", kind: "PATCH" },
];

// ─── Tasks ───────────────────────────────────────────────────────────────────
export const mockTasks: MissionTaskCard[] = [
  { task_id: "TSK-8825", title: "Optimize Image Loader", phase: "generating_code" },
  { task_id: "TSK-8826", title: "Setup Redis Cache", phase: "waiting_for_review" },
  { task_id: "TSK-8827", title: "Implement Websocket PubSub", phase: "analyzing_context" },
];

// ─── Spotlight ───────────────────────────────────────────────────────────────
export const mockSpotlight: TaskSpotlight = {
  task_id: "TSK-8825",
  title: "Optimize Image Loader",
  lifecycle: {
    current_phase: "generating_code",
    events: [
      { timestamp: new Date(Date.now() - 1000 * 120).toISOString(), severity: "INFO", message: "Task pulled from queue" },
      { timestamp: new Date(Date.now() - 1000 * 90).toISOString(), severity: "INFO", message: "Context window populated with 4 files" },
      { timestamp: new Date(Date.now() - 1000 * 30).toISOString(), severity: "INFO", message: "LLM generating unified patch" },
    ],
  },
  latest_transition_reason: "Sufficient context gathered.",
  phase_durations: {
    queued: 450,
    analyzing_context: 60,
    generating_code: 30,
  },
  latest_artifact: {
    payload: {
      outcome: {
        success: false,
        attempts: 1,
        patches_applied: 0,
        worker_id: 3,
        token_usage: { input_tokens: 3200, output_tokens: 200, total_tokens: 3400 },
      },
      llm_outputs: [
        "diff --git a/src/components/ImageLoader.tsx b/src/components/ImageLoader.tsx\n--- a/src/components/ImageLoader.tsx\n+++ b/src/components/ImageLoader.tsx\n@@ -1,5 +1,6 @@\n import React from 'react';\n+import { useInView } from 'react-intersection-observer';\n \n export const ImageLoader = ({ src, alt }) => {\n-  return <img src={src} alt={alt} />;\n+  return <img src={src} alt={alt} loading=\"lazy\" />;\n };"
      ],
      runtime_config: { use_codebase_graphrag: true },
    },
    markdown_summary: "## Task Progress\nCurrently analyzing the `ImageLoader.tsx` file to introduce lazy loading and WebP support.\n- Added `loading=\"lazy\"`\n- Investigating intersection observer for custom fade-in effect.",
    llm_output_count: 1,
  },
  failure: {},
};

// ─── Agents ──────────────────────────────────────────────────────────────────
export const mockAgents: AgentWorker[] = [
  {
    id: "worker-1",
    workerId: 1,
    status: "error",
    currentTask: "TSK-8824",
    taskTitle: "Refactor Database Schema",
    tokensUsed: 18200,
    tokensLimit: 32000,
    avgResponseTime: 3.8,
    completedTasks: 8,
    failedTasks: 2,
    uptime: "2h 34m",
    model: "qwen-coder-32b",
    capabilities: ["code-gen", "refactor", "schema"],
    lastHeartbeat: new Date(Date.now() - 1000 * 45).toISOString(),
  },
  {
    id: "worker-2",
    workerId: 2,
    status: "idle",
    currentTask: null,
    taskTitle: null,
    tokensUsed: 21600,
    tokensLimit: 32000,
    avgResponseTime: 1.2,
    completedTasks: 11,
    failedTasks: 0,
    uptime: "2h 34m",
    model: "qwen-coder-32b",
    capabilities: ["code-gen", "api", "middleware"],
    lastHeartbeat: new Date(Date.now() - 1000 * 5).toISOString(),
  },
  {
    id: "worker-3",
    workerId: 3,
    status: "active",
    currentTask: "TSK-8825",
    taskTitle: "Optimize Image Loader",
    tokensUsed: 3400,
    tokensLimit: 32000,
    avgResponseTime: 1.7,
    completedTasks: 5,
    failedTasks: 0,
    uptime: "2h 34m",
    model: "qwen-coder-32b",
    capabilities: ["code-gen", "ui", "perf"],
    lastHeartbeat: new Date(Date.now() - 1000 * 2).toISOString(),
  },
];

// ─── Patterns ────────────────────────────────────────────────────────────────
export const mockPatterns: CodePattern[] = [
  {
    id: "PAT-001",
    name: "Duplicate Route Handler",
    description: "Express route handlers with near-identical auth middleware logic duplicated across 12 files.",
    occurrences: 12,
    files: ["src/api/routes/user.ts", "src/api/routes/admin.ts", "src/api/routes/billing.ts"],
    confidence: 0.94,
    suggestion: "Extract to a shared router factory with built-in auth composition.",
    tags: ["backend", "refactor", "dry"],
    severity: "refactor",
  },
  {
    id: "PAT-002",
    name: "N+1 Query Pattern",
    description: "Nested database calls inside loops detected. High risk of N+1 query degradation at scale.",
    occurrences: 4,
    files: ["src/services/userService.ts", "src/services/orderService.ts"],
    confidence: 0.88,
    suggestion: "Use DataLoader or batch queries with Prisma's include to resolve relations in a single round-trip.",
    tags: ["database", "performance", "critical"],
    severity: "bug-prone",
  },
  {
    id: "PAT-003",
    name: "Unvalidated User Input",
    description: "Request body passed directly to database queries without schema validation in 3 endpoints.",
    occurrences: 3,
    files: ["src/api/routes/user.ts", "src/api/routes/search.ts"],
    confidence: 0.97,
    suggestion: "Add Zod or Joi validation middleware to all mutation endpoints.",
    tags: ["security", "validation", "high-priority"],
    severity: "security",
  },
  {
    id: "PAT-004",
    name: "Inline String Concatenation for SQL",
    description: "Raw SQL built via string concat. Potential for injection vulnerabilities.",
    occurrences: 2,
    files: ["src/db/queries/reports.ts"],
    confidence: 0.99,
    suggestion: "Replace with parameterized queries or ORM query builder methods.",
    tags: ["security", "sql", "critical"],
    severity: "security",
  },
  {
    id: "PAT-005",
    name: "Missing Error Boundaries",
    description: "React component trees lack error boundaries, single component failures cascade to full page crashes.",
    occurrences: 8,
    files: ["src/pages/Dashboard.tsx", "src/pages/Profile.tsx", "src/components/Feed.tsx"],
    confidence: 0.85,
    suggestion: "Wrap feature areas with <ErrorBoundary> components and implement graceful fallback UI.",
    tags: ["frontend", "resilience", "ux"],
    severity: "optimization",
  },
];

// ─── Telemetry ───────────────────────────────────────────────────────────────
function rng(base: number, variance: number) {
  return Math.floor(base + (Math.random() - 0.5) * variance);
}

export const mockTelemetryTokens: TelemetryDataPoint[] = Array.from({ length: 24 }, (_, i) => {
  const w1 = rng(400, 300);
  const w2 = rng(320, 200);
  const w3 = rng(180, 150);
  return { time: `${i * 5}m`, w1, w2, w3, total: w1 + w2 + w3 };
});

export const mockTelemetryTasks: TaskCompletionPoint[] = [
  { hour: "14:00", completed: 2, failed: 0 },
  { hour: "14:15", completed: 4, failed: 1 },
  { hour: "14:30", completed: 6, failed: 0 },
  { hour: "14:45", completed: 3, failed: 2 },
  { hour: "15:00", completed: 8, failed: 0 },
  { hour: "15:15", completed: 5, failed: 1 },
  { hour: "15:30", completed: 7, failed: 0 },
  { hour: "15:45", completed: 9, failed: 0 },
  { hour: "16:00", completed: 3, failed: 1 },
];

// ─── Codebase Files ──────────────────────────────────────────────────────────
export const mockCodebaseFiles: CodebaseFile[] = [
  { path: "src/api/middleware/auth.ts", status: "modified", lines: 87, agent: "worker-2", taskId: "TSK-8821" },
  { path: "src/api/routes/user.ts", status: "modified", lines: 134, agent: "worker-2", taskId: "TSK-8821" },
  { path: "prisma/schema.prisma", status: "modified", lines: 210, agent: "worker-1", taskId: "TSK-8824" },
  { path: "src/db/migrations/2023_01_01_init.sql", status: "added", lines: 45, agent: "worker-1", taskId: "TSK-8824" },
  { path: "src/components/ImageLoader.tsx", status: "modified", lines: 62, agent: "worker-3", taskId: "TSK-8825" },
  { path: "src/api/middleware/rateLimit.ts", status: "added", lines: 55, agent: "worker-2", taskId: "TSK-8818" },
  { path: "src/api/decorators/limit.ts", status: "added", lines: 30, agent: "worker-2", taskId: "TSK-8818" },
  { path: "src/db/pool.ts", status: "modified", lines: 78, agent: "worker-1", taskId: "TSK-8819" },
  { path: "config/database.yml", status: "modified", lines: 22, agent: "worker-1", taskId: "TSK-8819" },
  { path: "src/services/userService.ts", status: "unchanged", lines: 201, agent: null, taskId: null },
  { path: "src/services/orderService.ts", status: "unchanged", lines: 156, agent: null, taskId: null },
  { path: "src/pages/Dashboard.tsx", status: "unchanged", lines: 312, agent: null, taskId: null },
];

export const mockFileContent: Record<string, string> = {
  "src/components/ImageLoader.tsx": `import React from 'react';
import { useInView } from 'react-intersection-observer';

interface ImageLoaderProps {
  src: string;
  alt: string;
  className?: string;
}

export const ImageLoader = ({ src, alt, className }: ImageLoaderProps) => {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.1 });

  return (
    <div ref={ref} className={className}>
      {inView ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="transition-opacity duration-300 opacity-0 data-[loaded]:opacity-100"
          onLoad={(e) => e.currentTarget.dataset.loaded = 'true'}
        />
      ) : (
        <div className="animate-pulse bg-zinc-800 rounded w-full h-full" />
      )}
    </div>
  );
};`,
  "src/api/middleware/auth.ts": `import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET!;

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload as any;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}`,
};

// ─── Artifacts ───────────────────────────────────────────────────────────────
export const mockArtifacts: ArtifactItem[] = [
  {
    id: "ART-001",
    taskId: "TSK-8821",
    type: "patch",
    filename: "auth.middleware.patch",
    content: "--- a/src/api/middleware/auth.ts\n+++ b/src/api/middleware/auth.ts\n@@ -1,5 +1,7 @@\n+import jwt from 'jsonwebtoken';\n ...",
    size: "2.4 KB",
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    status: "applied",
    language: "diff",
  },
  {
    id: "ART-002",
    taskId: "TSK-8824",
    type: "diff",
    filename: "schema.prisma.diff",
    content: "--- a/prisma/schema.prisma\n+++ b/prisma/schema.prisma\n...",
    size: "5.1 KB",
    createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    status: "rejected",
    language: "diff",
  },
  {
    id: "ART-003",
    taskId: "TSK-8825",
    type: "generated",
    filename: "ImageLoader.tsx",
    content: "import React from 'react';\n...",
    size: "1.8 KB",
    createdAt: new Date(Date.now() - 1000 * 60 * 1).toISOString(),
    status: "pending",
    language: "typescript",
  },
  {
    id: "ART-004",
    taskId: "TSK-8818",
    type: "generated",
    filename: "rateLimit.ts",
    content: "import rateLimit from 'express-rate-limit';\n...",
    size: "3.2 KB",
    createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    status: "applied",
    language: "typescript",
  },
  {
    id: "ART-005",
    taskId: "TSK-8821",
    type: "analysis",
    filename: "auth-analysis.md",
    content: "## Auth Middleware Analysis\n\nCurrent implementation lacks...",
    size: "4.7 KB",
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    status: "applied",
    language: "markdown",
  },
];

// ─── Console Logs ─────────────────────────────────────────────────────────────
export const mockConsoleLogs: ConsoleLog[] = [
  { id: "l1", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(), message: "Orchestrator initialized. Config loaded from mission.yml.", source: "orchestrator" },
  { id: "l2", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 59).toISOString(), message: "Worker pool starting: 3 workers requested.", source: "pool-manager" },
  { id: "l3", level: "success", timestamp: new Date(Date.now() - 1000 * 60 * 58).toISOString(), message: "Worker-1 online. Model: qwen-coder-32b. Ready.", source: "worker-1" },
  { id: "l4", level: "success", timestamp: new Date(Date.now() - 1000 * 60 * 57).toISOString(), message: "Worker-2 online. Model: qwen-coder-32b. Ready.", source: "worker-2" },
  { id: "l5", level: "success", timestamp: new Date(Date.now() - 1000 * 60 * 56).toISOString(), message: "Worker-3 online. Model: qwen-coder-32b. Ready.", source: "worker-3" },
  { id: "l6", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 55).toISOString(), message: "Dispatching TSK-8821 → worker-2. Priority: HIGH.", source: "orchestrator", taskId: "TSK-8821" },
  { id: "l7", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 54).toISOString(), message: "TSK-8821 analyzing context. Codebase graphrag active.", source: "worker-2", taskId: "TSK-8821" },
  { id: "l8", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 50).toISOString(), message: "Parallel execution mode activated. 3 tasks in queue.", source: "orchestrator" },
  { id: "l9", level: "success", timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), message: "TSK-8821 patch applied successfully. 4 files modified.", source: "worker-2", taskId: "TSK-8821" },
  { id: "l10", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 40).toISOString(), message: "Dispatching TSK-8818 → worker-2. Priority: MEDIUM.", source: "orchestrator", taskId: "TSK-8818" },
  { id: "l11", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(), message: "Dispatching TSK-8824 → worker-1. Priority: HIGH.", source: "orchestrator", taskId: "TSK-8824" },
  { id: "l12", level: "warn", timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), message: "Worker-1 response latency spike: 3800ms (threshold: 2000ms).", source: "monitor" },
  { id: "l13", level: "success", timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(), message: "TSK-8818 completed. Rate limiter middleware deployed.", source: "worker-2", taskId: "TSK-8818" },
  { id: "l14", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString(), message: "Dispatching TSK-8819 → worker-1. Priority: HIGH.", source: "orchestrator", taskId: "TSK-8819" },
  { id: "l15", level: "error", timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), message: "TSK-8819 VERIFY_FAIL: Pool min(5) > max(3) in staging config.", source: "verifier", taskId: "TSK-8819" },
  { id: "l16", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(), message: "Dispatching TSK-8825 → worker-3. Priority: MEDIUM.", source: "orchestrator", taskId: "TSK-8825" },
  { id: "l17", level: "info", timestamp: new Date(Date.now() - 1000 * 60 * 8).toISOString(), message: "TSK-8825 context analysis complete. 4 relevant files found.", source: "worker-3", taskId: "TSK-8825" },
  { id: "l18", level: "error", timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), message: "TSK-8824 PATCH_FAIL: Merge conflict in prisma/schema.prisma line 142.", source: "worker-1", taskId: "TSK-8824" },
  { id: "l19", level: "debug", timestamp: new Date(Date.now() - 1000 * 60 * 1).toISOString(), message: "TSK-8825 generating unified diff. LLM stream active.", source: "worker-3", taskId: "TSK-8825" },
  { id: "l20", level: "info", timestamp: new Date(Date.now() - 30000).toISOString(), message: "Heartbeat check: worker-1 degraded, worker-2 idle, worker-3 active.", source: "monitor" },
];
