import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ShadowGitService } from "./shadowGitService";

describe("ShadowGitService", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-git-test-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("initialize creates directory and git repo", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();

    const snapshotDir = path.join(root, "snapshots");
    expect(fs.existsSync(snapshotDir)).toBe(true);
    expect(fs.existsSync(path.join(snapshotDir, ".git"))).toBe(true);
  });

  it("initialize is idempotent", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();
    service.initialize(); // should not throw
    expect(fs.existsSync(path.join(root, "snapshots", ".git"))).toBe(true);
  });

  it("snapshot creates a commit", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();

    const snap = service.snapshot({
      filePath: "src/hello.ts",
      content: 'export const hello = "world";',
      stepId: "001",
      description: "add hello module",
    });

    expect(snap.commitHash).toBeTruthy();
    expect(snap.commitHash.length).toBeGreaterThanOrEqual(7);
    expect(snap.stepId).toBe("001");
    expect(snap.description).toBe("add hello module");
    expect(snap.filePath).toBe("src/hello.ts");
    expect(snap.createdAt).toBeTruthy();
  });

  it("snapshot stores snapshot in list", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();

    service.snapshot({
      filePath: "file.ts",
      content: "v1",
      stepId: "s1",
      description: "first",
    });

    const list = service.listSnapshots();
    expect(list).toHaveLength(1);
    expect(list[0].stepId).toBe("s1");
  });

  it("rollback returns correct content", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();

    service.snapshot({
      filePath: "data.txt",
      content: "original content",
      stepId: "step-a",
      description: "write original",
    });

    const result = service.rollback("step-a");
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe("data.txt");
    expect(result!.content).toBe("original content");
  });

  it("rollback returns null for unknown stepId", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();

    const result = service.rollback("nonexistent");
    expect(result).toBeNull();
  });

  it("listSnapshots returns all snapshots", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();

    service.snapshot({ filePath: "a.ts", content: "a", stepId: "1", description: "first" });
    service.snapshot({ filePath: "b.ts", content: "b", stepId: "2", description: "second" });
    service.snapshot({ filePath: "c.ts", content: "c", stepId: "3", description: "third" });

    const list = service.listSnapshots();
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.stepId)).toEqual(["1", "2", "3"]);
  });

  it("getSnapshot finds by stepId", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();

    service.snapshot({ filePath: "x.ts", content: "x", stepId: "abc", description: "test" });

    expect(service.getSnapshot("abc")).not.toBeNull();
    expect(service.getSnapshot("abc")!.stepId).toBe("abc");
    expect(service.getSnapshot("missing")).toBeNull();
  });

  it("pruneOldSnapshots removes excess", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, {
      snapshotDir: "snapshots",
      maxSnapshots: 3,
    });
    service.initialize();

    for (let i = 0; i < 5; i++) {
      service.snapshot({
        filePath: `file${i}.ts`,
        content: `content-${i}`,
        stepId: `step-${i}`,
        description: `step ${i}`,
      });
    }

    // Auto-pruning kicks in after the 4th snapshot (exceeds maxSnapshots=3).
    // After 5 snapshots, the oldest ones are pruned to keep only 3.
    const list = service.listSnapshots();
    expect(list).toHaveLength(3);
    // The remaining snapshots should be the most recent ones
    expect(list[0].stepId).toBe("step-2");
    expect(list[1].stepId).toBe("step-3");
    expect(list[2].stepId).toBe("step-4");

    // Calling pruneOldSnapshots again when already at limit returns 0
    const removed = service.pruneOldSnapshots();
    expect(removed).toBe(0);
  });

  it("multiple snapshots for same file (version history)", () => {
    const root = makeTmpDir();
    const service = new ShadowGitService(root, { snapshotDir: "snapshots" });
    service.initialize();

    service.snapshot({
      filePath: "main.ts",
      content: "// version 1",
      stepId: "v1",
      description: "version 1",
    });

    service.snapshot({
      filePath: "main.ts",
      content: "// version 2",
      stepId: "v2",
      description: "version 2",
    });

    service.snapshot({
      filePath: "main.ts",
      content: "// version 3",
      stepId: "v3",
      description: "version 3",
    });

    // Rollback to v1 should return version 1 content
    const r1 = service.rollback("v1");
    expect(r1).not.toBeNull();
    expect(r1!.content).toBe("// version 1");

    // Rollback to v2 should return version 2 content
    const r2 = service.rollback("v2");
    expect(r2).not.toBeNull();
    expect(r2!.content).toBe("// version 2");

    // Current (v3)
    const r3 = service.rollback("v3");
    expect(r3).not.toBeNull();
    expect(r3!.content).toBe("// version 3");

    expect(service.listSnapshots()).toHaveLength(3);
  });
});
