import { describe, it, expect, vi } from "vitest";
import { createRootAbortController } from "./abortHierarchy";

describe("abortHierarchy", () => {
  describe("createRootAbortController", () => {
    it("creates a non-aborted controller", () => {
      const root = createRootAbortController("test");
      expect(root.aborted).toBe(false);
      expect(root.label).toBe("test");
    });

    it("defaults label to 'root'", () => {
      const root = createRootAbortController();
      expect(root.label).toBe("root");
    });
  });

  describe("abort", () => {
    it("sets aborted to true", () => {
      const root = createRootAbortController("test");
      root.abort();
      expect(root.aborted).toBe(true);
    });

    it("fires abort event on signal", () => {
      const root = createRootAbortController("test");
      const handler = vi.fn();
      root.signal.addEventListener("abort", handler);
      root.abort();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("includes reason in abort", () => {
      const root = createRootAbortController("test");
      root.abort("user_cancelled");
      expect(root.signal.reason).toBe("user_cancelled");
    });

    it("is no-op on already-aborted controller", () => {
      const root = createRootAbortController("test");
      root.abort("first");
      root.abort("second"); // should not throw
      expect(root.signal.reason).toBe("first");
    });
  });

  describe("fork", () => {
    it("creates child that inherits parent abort", () => {
      const root = createRootAbortController("root");
      const child = root.fork("child");

      expect(child.aborted).toBe(false);
      root.abort("parent_abort");
      expect(child.aborted).toBe(true);
      expect(child.signal.reason).toBe("parent_abort");
    });

    it("child abort does not propagate to parent", () => {
      const root = createRootAbortController("root");
      const child = root.fork("child");

      child.abort("child_abort");
      expect(child.aborted).toBe(true);
      expect(root.aborted).toBe(false);
    });

    it("parent abort cascades to all children", () => {
      const root = createRootAbortController("root");
      const child1 = root.fork("c1");
      const child2 = root.fork("c2");
      const child3 = root.fork("c3");

      root.abort("cascade");
      expect(child1.aborted).toBe(true);
      expect(child2.aborted).toBe(true);
      expect(child3.aborted).toBe(true);
    });

    it("child abort does not affect siblings", () => {
      const root = createRootAbortController("root");
      const child1 = root.fork("c1");
      const child2 = root.fork("c2");

      child1.abort("just_me");
      expect(child1.aborted).toBe(true);
      expect(child2.aborted).toBe(false);
      expect(root.aborted).toBe(false);
    });

    it("label propagates to child with prefix", () => {
      const root = createRootAbortController("root");
      const child = root.fork("child");
      expect(child.label).toBe("root/child");
    });

    it("defaults child label", () => {
      const root = createRootAbortController("root");
      const child = root.fork();
      expect(child.label).toBe("root/child");
    });

    it("multiple nesting levels work", () => {
      const root = createRootAbortController("L0");
      const l1 = root.fork("L1");
      const l2 = l1.fork("L2");
      const l3 = l2.fork("L3");

      expect(l3.label).toBe("L0/L1/L2/L3");

      root.abort("deep_cascade");
      expect(l1.aborted).toBe(true);
      expect(l2.aborted).toBe(true);
      expect(l3.aborted).toBe(true);
    });

    it("mid-level abort cascades to descendants but not ancestors", () => {
      const root = createRootAbortController("root");
      const child = root.fork("child");
      const grandchild = child.fork("grandchild");

      child.abort("mid_abort");
      expect(root.aborted).toBe(false);
      expect(child.aborted).toBe(true);
      expect(grandchild.aborted).toBe(true);
    });

    it("already-aborted child does not re-abort on parent abort", () => {
      const root = createRootAbortController("root");
      const child = root.fork("child");
      const handler = vi.fn();

      child.abort("early");
      child.signal.addEventListener("abort", handler);

      root.abort("late"); // child already aborted, should not re-fire
      expect(handler).not.toHaveBeenCalled();
    });

    it("parent abort propagates reason through fork handler to child", () => {
      const root = createRootAbortController("root");
      const child = root.fork("task");
      const grandchild = child.fork("subtask");

      // Abort root with a specific reason — should propagate through the
      // fork handler (lines 62-66) to child and grandchild
      root.abort("timeout_reached");
      expect(child.signal.reason).toBe("timeout_reached");
      expect(grandchild.signal.reason).toBe("timeout_reached");
    });

    it("child auto-cleanup removes parent listener when child aborts independently", () => {
      const root = createRootAbortController("root");
      const child1 = root.fork("c1");
      const child2 = root.fork("c2");

      // Abort child1 independently — its cleanup handler (line 74) should
      // remove the parent's abort listener for child1
      child1.abort("done");

      // Now abort root — child2 should still get it, child1 should not re-fire
      const child1Handler = vi.fn();
      child1.signal.addEventListener("abort", child1Handler);
      root.abort("root_done");

      expect(child2.aborted).toBe(true);
      // child1 was already aborted, handler should not be called again
      expect(child1Handler).not.toHaveBeenCalled();
    });

    it("handles abort with no explicit reason", () => {
      const root = createRootAbortController("root");
      const child = root.fork("task");

      root.abort(); // no reason provided — AbortController uses default DOMException
      expect(child.aborted).toBe(true);
      // The child should still be aborted even without an explicit string reason
      expect(root.aborted).toBe(true);
    });
  });
});
