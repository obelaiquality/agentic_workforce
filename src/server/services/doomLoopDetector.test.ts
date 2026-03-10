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
});
