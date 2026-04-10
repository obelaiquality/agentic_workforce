// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  DND_TYPE,
  LANE_META,
  STATUS_LABELS,
  laneMetaFor,
  allowedMoves,
  toMoveRequest,
  progressForCard,
  metricTone,
  formatAgenticEventLabel,
  lifecycleNoticeToneClass,
  laneSurfaceClass,
  readExecutionProfileSnapshot,
  countCommentThread,
} from "./helpers";

function makeCard(overrides: Partial<any> = {}) {
  return {
    workflowId: "wf-1",
    status: "backlog" as const,
    rawStatus: "backlog",
    progress: undefined,
    ...overrides,
  };
}

describe("helpers", () => {
  describe("DND_TYPE", () => {
    it("equals MISSION_WORKFLOW_CARD", () => {
      expect(DND_TYPE).toBe("MISSION_WORKFLOW_CARD");
    });
  });

  describe("LANE_META", () => {
    it("has 4 entries", () => {
      expect(LANE_META).toHaveLength(4);
    });

    it("keys are backlog, in_progress, needs_review, completed", () => {
      const keys = LANE_META.map((l) => l.key);
      expect(keys).toEqual(["backlog", "in_progress", "needs_review", "completed"]);
    });
  });

  describe("STATUS_LABELS", () => {
    it("maps known statuses to labels", () => {
      expect(STATUS_LABELS["backlog"]).toBe("Backlog");
      expect(STATUS_LABELS["done"]).toBe("Completed");
    });
  });

  describe("laneMetaFor", () => {
    it("returns entry with key backlog", () => {
      const result = laneMetaFor("backlog");
      expect(result.key).toBe("backlog");
      expect(result.label).toBe("Backlog");
    });

    it("returns entry with key completed", () => {
      const result = laneMetaFor("completed");
      expect(result.key).toBe("completed");
      expect(result.label).toBe("Completed");
    });
  });

  describe("allowedMoves", () => {
    it("backlog can move to in_progress", () => {
      expect(allowedMoves("backlog")).toEqual(["in_progress"]);
    });

    it("in_progress can move to backlog or needs_review", () => {
      expect(allowedMoves("in_progress")).toEqual(["backlog", "needs_review"]);
    });

    it("needs_review can move to in_progress or completed", () => {
      expect(allowedMoves("needs_review")).toEqual(["in_progress", "completed"]);
    });

    it("completed can move to needs_review", () => {
      expect(allowedMoves("completed")).toEqual(["needs_review"]);
    });
  });

  describe("toMoveRequest", () => {
    it("builds correct move request object", () => {
      const card = makeCard({ workflowId: "wf-42", status: "backlog" });
      const result = toMoveRequest(card as any, "in_progress", "wf-99");
      expect(result).toEqual({
        workflowId: "wf-42",
        fromStatus: "backlog",
        toStatus: "in_progress",
        beforeWorkflowId: "wf-99",
      });
    });

    it("defaults beforeWorkflowId to null", () => {
      const card = makeCard();
      const result = toMoveRequest(card as any, "in_progress");
      expect(result.beforeWorkflowId).toBeNull();
    });
  });

  describe("progressForCard", () => {
    it("returns the numeric progress when item.progress is set", () => {
      const card = makeCard({ progress: 75 });
      expect(progressForCard(card as any)).toBe(75);
    });

    it("returns 100 for rawStatus done", () => {
      expect(progressForCard(makeCard({ rawStatus: "done" }) as any)).toBe(100);
    });

    it("returns 82 for rawStatus review", () => {
      expect(progressForCard(makeCard({ rawStatus: "review" }) as any)).toBe(82);
    });

    it("returns 58 for rawStatus blocked", () => {
      expect(progressForCard(makeCard({ rawStatus: "blocked" }) as any)).toBe(58);
    });

    it("returns 64 for rawStatus in_progress", () => {
      expect(progressForCard(makeCard({ rawStatus: "in_progress" }) as any)).toBe(64);
    });

    it("returns 34 for rawStatus ready", () => {
      expect(progressForCard(makeCard({ rawStatus: "ready" }) as any)).toBe(34);
    });

    it("returns 18 for unknown rawStatus", () => {
      expect(progressForCard(makeCard({ rawStatus: "unknown" }) as any)).toBe(18);
    });
  });

  describe("metricTone", () => {
    it("returns emerald classes for completed", () => {
      expect(metricTone("completed")).toContain("emerald");
    });

    it("returns violet classes for needs_review", () => {
      expect(metricTone("needs_review")).toContain("violet");
    });

    it("returns fuchsia classes for in_progress", () => {
      expect(metricTone("in_progress")).toContain("fuchsia");
    });

    it("returns cyan classes for backlog (default)", () => {
      expect(metricTone("backlog")).toContain("cyan");
    });
  });

  describe("formatAgenticEventLabel", () => {
    it("replaces underscores with spaces", () => {
      expect(formatAgenticEventLabel("tool_use_started")).toBe("tool use started");
    });

    it("returns unchanged string when no underscores", () => {
      expect(formatAgenticEventLabel("completed")).toBe("completed");
    });
  });

  describe("lifecycleNoticeToneClass", () => {
    it("returns emerald class for success", () => {
      expect(lifecycleNoticeToneClass("success")).toContain("emerald");
    });

    it("returns amber class for warn", () => {
      expect(lifecycleNoticeToneClass("warn")).toContain("amber");
    });

    it("returns cyan class for info (default)", () => {
      expect(lifecycleNoticeToneClass("info")).toContain("cyan");
    });
  });

  describe("laneSurfaceClass", () => {
    it("returns different gradient classes per lane", () => {
      const classes = new Set([
        laneSurfaceClass("backlog"),
        laneSurfaceClass("in_progress"),
        laneSurfaceClass("needs_review"),
        laneSurfaceClass("completed"),
      ]);
      expect(classes.size).toBe(4);
    });

    it("returns emerald gradient for completed", () => {
      expect(laneSurfaceClass("completed")).toContain("16,185,129");
    });

    it("returns cyan gradient for backlog (default)", () => {
      expect(laneSurfaceClass("backlog")).toContain("34,211,238");
    });
  });

  describe("readExecutionProfileSnapshot", () => {
    it("returns null for null input", () => {
      expect(readExecutionProfileSnapshot(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
      expect(readExecutionProfileSnapshot(undefined)).toBeNull();
    });

    it("returns null for metadata without execution_profile_snapshot", () => {
      expect(readExecutionProfileSnapshot({})).toBeNull();
    });

    it("returns null for invalid data (missing fields)", () => {
      expect(
        readExecutionProfileSnapshot({
          execution_profile_snapshot: { profileId: "p1" },
        })
      ).toBeNull();
    });

    it("returns null when stages array contains only invalid entries", () => {
      expect(
        readExecutionProfileSnapshot({
          execution_profile_snapshot: {
            profileId: "p1",
            profileName: "Balanced",
            stages: [{ stage: 123 }],
          },
        })
      ).toBeNull();
    });

    it("returns valid object for proper data", () => {
      const result = readExecutionProfileSnapshot({
        execution_profile_snapshot: {
          profileId: "p1",
          profileName: "Balanced",
          stages: [
            { stage: "plan", role: "planner", providerId: "openai", model: "gpt-4" },
            { stage: "code", role: "coder", providerId: "qwen", model: "qwen-4b" },
          ],
        },
      });
      expect(result).toEqual({
        profileId: "p1",
        profileName: "Balanced",
        stages: [
          { stage: "plan", role: "planner", providerId: "openai", model: "gpt-4" },
          { stage: "code", role: "coder", providerId: "qwen", model: "qwen-4b" },
        ],
      });
    });
  });

  describe("countCommentThread", () => {
    it("returns 0 for empty array", () => {
      expect(countCommentThread([])).toBe(0);
    });

    it("counts flat comments correctly", () => {
      const comments = [
        { replies: [] },
        { replies: [] },
        { replies: [] },
      ];
      expect(countCommentThread(comments)).toBe(3);
    });

    it("counts nested replies recursively", () => {
      const comments = [
        {
          replies: [
            { replies: [{ replies: [] }] },
            { replies: [] },
          ],
        },
        { replies: [] },
      ];
      // Top level: 2 comments
      // First comment has 2 replies, one of which has 1 reply
      // Total: 2 + 2 + 1 = 5
      expect(countCommentThread(comments)).toBe(5);
    });
  });
});
