import { describe, it, expect } from "vitest";
import { DoomLoopDetector } from "./doomLoopDetector";

describe("DoomLoopDetector", () => {
  it("does not trigger when fewer than threshold identical actions are recorded", () => {
    const detector = new DoomLoopDetector(20, 3);
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    expect(detector.isLooping()).toBe(false);
  });

  it("triggers when threshold identical actions are recorded", () => {
    const detector = new DoomLoopDetector(20, 3);
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    expect(detector.isLooping()).toBe(true);
  });

  it("does not trigger for different actions", () => {
    const detector = new DoomLoopDetector(20, 3);
    detector.record("readFile", { path: "/a.ts" });
    detector.record("readFile", { path: "/b.ts" });
    detector.record("readFile", { path: "/c.ts" });
    detector.record("writeFile", { path: "/a.ts" });
    detector.record("deleteFile", { path: "/a.ts" });
    expect(detector.isLooping()).toBe(false);
  });

  it("slides the window so old entries fall off", () => {
    const detector = new DoomLoopDetector(4, 3);
    // Fill with 3 identical actions — should trigger
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    expect(detector.isLooping()).toBe(true);

    // Push 2 different actions to slide the window past the repeats
    detector.record("writeFile", { path: "/bar.ts" });
    detector.record("deleteFile", { path: "/baz.ts" });
    // Window now has at most 4 entries; only 1 readFile remains
    expect(detector.isLooping()).toBe(false);
  });

  it("reset() clears all state", () => {
    const detector = new DoomLoopDetector(20, 3);
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    expect(detector.isLooping()).toBe(true);

    detector.reset();
    expect(detector.isLooping()).toBe(false);
    expect(detector.stats().recorded).toBe(0);
  });

  it("getLoopingAction() returns the correct action name when looping", () => {
    const detector = new DoomLoopDetector(20, 3);
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    expect(detector.getLoopingAction()).toBe("readFile");
  });

  it("getLoopingAction() returns null when not looping", () => {
    const detector = new DoomLoopDetector(20, 3);
    detector.record("readFile", { path: "/foo.ts" });
    expect(detector.getLoopingAction()).toBeNull();
  });

  it("getLoopingAction() returns the most repeated action when multiple exceed threshold", () => {
    const detector = new DoomLoopDetector(20, 2);
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("writeFile", { path: "/bar.ts" });
    detector.record("writeFile", { path: "/bar.ts" });
    expect(detector.getLoopingAction()).toBe("readFile");
  });

  it("stats() returns correct values", () => {
    const detector = new DoomLoopDetector(10, 4);
    detector.record("readFile", { path: "/foo.ts" });
    detector.record("writeFile", { path: "/bar.ts" });

    const s = detector.stats();
    expect(s.windowSize).toBe(10);
    expect(s.recorded).toBe(2);
    expect(s.threshold).toBe(4);
    expect(s.looping).toBe(false);
  });

  it("produces deterministic fingerprints regardless of arg key order", () => {
    const detector = new DoomLoopDetector(20, 2);
    detector.record("edit", { path: "/x.ts", line: 10 });
    detector.record("edit", { line: 10, path: "/x.ts" });
    expect(detector.isLooping()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Chain depth tracking
  // ---------------------------------------------------------------------------

  describe("chain depth tracking", () => {
    it("getChainContext returns initial depth of 0", () => {
      const detector = new DoomLoopDetector();
      const context = detector.getChainContext();
      expect(context.depth).toBe(0);
      expect(context.chainId).toBeTruthy();
    });

    it("createChildChain increments depth by 1", () => {
      const detector = new DoomLoopDetector();
      const parent = detector.getChainContext();
      const child = detector.createChildChain();

      expect(child.depth).toBe(parent.depth + 1);
      expect(child.chainId).toBe(parent.chainId);
    });

    it("createChildChain does not mutate current context", () => {
      const detector = new DoomLoopDetector();
      const before = detector.getChainContext();
      detector.createChildChain();
      const after = detector.getChainContext();

      expect(after.depth).toBe(before.depth);
    });

    it("setChainContext updates the chain context", () => {
      const detector = new DoomLoopDetector();
      const newContext = { chainId: "custom-id", depth: 3 };

      detector.setChainContext(newContext);

      const current = detector.getChainContext();
      expect(current.chainId).toBe("custom-id");
      expect(current.depth).toBe(3);
    });

    it("isDepthExceeded returns false when below limit", () => {
      const detector = new DoomLoopDetector(20, 3, 5);
      detector.setChainContext({ chainId: "test", depth: 4 });
      expect(detector.isDepthExceeded()).toBe(false);
    });

    it("isDepthExceeded returns true when at limit", () => {
      const detector = new DoomLoopDetector(20, 3, 5);
      detector.setChainContext({ chainId: "test", depth: 5 });
      expect(detector.isDepthExceeded()).toBe(true);
    });

    it("isDepthExceeded returns true when over limit", () => {
      const detector = new DoomLoopDetector(20, 3, 5);
      detector.setChainContext({ chainId: "test", depth: 10 });
      expect(detector.isDepthExceeded()).toBe(true);
    });

    it("incrementDepth increases depth and returns true when within limit", () => {
      const detector = new DoomLoopDetector(20, 3, 5);
      detector.setChainContext({ chainId: "test", depth: 3 });

      const result = detector.incrementDepth();
      expect(result).toBe(true);
      expect(detector.getChainContext().depth).toBe(4);
    });

    it("incrementDepth returns false when limit would be exceeded", () => {
      const detector = new DoomLoopDetector(20, 3, 5);
      detector.setChainContext({ chainId: "test", depth: 5 });

      const result = detector.incrementDepth();
      expect(result).toBe(false);
      expect(detector.getChainContext().depth).toBe(5);
    });

    it("incrementDepth stops at limit", () => {
      const detector = new DoomLoopDetector(20, 3, 2);
      detector.setChainContext({ chainId: "test", depth: 0 });

      expect(detector.incrementDepth()).toBe(true);
      expect(detector.getChainContext().depth).toBe(1);

      // At depth 1, another increment would exceed the limit (2)
      expect(detector.incrementDepth()).toBe(true);
      expect(detector.getChainContext().depth).toBe(2);

      // At depth 2 (limit reached), can't increment further
      expect(detector.incrementDepth()).toBe(false);
      expect(detector.getChainContext().depth).toBe(2);
    });

    it("stats includes chainDepth", () => {
      const detector = new DoomLoopDetector(20, 3, 5);
      detector.setChainContext({ chainId: "test", depth: 2 });

      const s = detector.stats();
      expect(s.chainDepth).toBe(2);
    });

    it("uses default max depth of 5", () => {
      const detector = new DoomLoopDetector();
      detector.setChainContext({ chainId: "test", depth: 4 });
      expect(detector.isDepthExceeded()).toBe(false);

      detector.setChainContext({ chainId: "test", depth: 5 });
      expect(detector.isDepthExceeded()).toBe(true);
    });

    it("nested child chains accumulate depth", () => {
      const detector = new DoomLoopDetector();
      const level0 = detector.getChainContext();
      expect(level0.depth).toBe(0);

      const level1 = detector.createChildChain();
      expect(level1.depth).toBe(1);

      detector.setChainContext(level1);
      const level2 = detector.createChildChain();
      expect(level2.depth).toBe(2);

      detector.setChainContext(level2);
      const level3 = detector.createChildChain();
      expect(level3.depth).toBe(3);
    });
  });
});
