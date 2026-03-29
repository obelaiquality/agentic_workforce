import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export interface ShadowSnapshot {
  stepId: string;
  description: string;
  filePath: string;
  commitHash: string;
  createdAt: string;
}

export interface ShadowGitConfig {
  maxSnapshots: number;
  snapshotDir: string;
}

const DEFAULT_CONFIG: ShadowGitConfig = {
  maxSnapshots: 50,
  snapshotDir: ".agentic-workforce/snapshots",
};

export class ShadowGitService {
  private snapshotDir: string;
  private snapshots: ShadowSnapshot[] = [];
  private maxSnapshots: number;

  constructor(projectRoot: string, config?: Partial<ShadowGitConfig>) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.snapshotDir = path.resolve(projectRoot, merged.snapshotDir);
    this.maxSnapshots = merged.maxSnapshots;
    this.snapshots = [];
  }

  initialize(): void {
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }

    const gitDir = path.join(this.snapshotDir, ".git");
    if (!fs.existsSync(gitDir)) {
      try {
        execFileSync("git", ["init", "-q", "-b", "main"], { cwd: this.snapshotDir, encoding: "utf8" });
      } catch (err) {
        throw new Error(
          `Failed to initialize git repo in ${this.snapshotDir}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err }
        );
      }
    }
  }

  snapshot(input: {
    filePath: string;
    content: string;
    stepId: string;
    description: string;
  }): ShadowSnapshot {
    const { filePath, content, stepId, description } = input;

    const fullPath = path.join(this.snapshotDir, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf8");

    const execOpts = { cwd: this.snapshotDir, encoding: "utf8" as const };

    try {
      execFileSync("git", ["add", "--", filePath], execOpts);
    } catch (err) {
      throw new Error(
        `Failed to git add ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }

    const commitMessage = `step-${stepId}: ${description}`;
    try {
      execFileSync("git", ["commit", "-m", commitMessage], execOpts);
    } catch (err) {
      throw new Error(
        `Failed to git commit: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }

    let commitHash: string;
    try {
      commitHash = execFileSync("git", ["rev-parse", "HEAD"], execOpts).trim();
    } catch (err) {
      throw new Error(
        `Failed to get commit hash: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }

    const snapshot: ShadowSnapshot = {
      stepId,
      description,
      filePath,
      commitHash,
      createdAt: new Date().toISOString(),
    };

    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.maxSnapshots) {
      this.pruneOldSnapshots();
    }

    return snapshot;
  }

  rollback(stepId: string): { filePath: string; content: string } | null {
    const snap = this.snapshots.find((s) => s.stepId === stepId);
    if (!snap) return null;

    const execOpts = { cwd: this.snapshotDir, encoding: "utf8" as const };

    if (!/^[0-9a-f]{40}$/.test(snap.commitHash)) {
      throw new Error(`Invalid commit hash for step ${stepId}: ${snap.commitHash}`);
    }

    try {
      const content = execFileSync(
        "git", ["show", `${snap.commitHash}:${snap.filePath}`],
        execOpts
      ).toString();
      return { filePath: snap.filePath, content };
    } catch (err) {
      throw new Error(
        `Failed to rollback step ${stepId}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  listSnapshots(): ShadowSnapshot[] {
    return [...this.snapshots];
  }

  getSnapshot(stepId: string): ShadowSnapshot | null {
    return this.snapshots.find((s) => s.stepId === stepId) ?? null;
  }

  pruneOldSnapshots(): number {
    const excess =
      this.snapshots.length > this.maxSnapshots
        ? this.snapshots.length - this.maxSnapshots
        : 0;
    if (excess > 0) {
      this.snapshots.splice(0, excess);
    }
    return excess;
  }
}
