// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { RepoRegistration } from "../../shared/contracts";
import { getRecentRepos, getVisibleRepos, isDeveloperOnlyRepo } from "./projectVisibility";

function makeRepo(overrides: Partial<RepoRegistration> = {}): RepoRegistration {
  return {
    id: "repo-1",
    displayName: "test-repo",
    sourceUri: "https://github.com/owner/repo",
    sourceKind: "local_path",
    repoRoot: "/tmp/repo",
    managedWorktreeRoot: "/tmp/worktree",
    active: true,
    benchmarkEligible: false,
    updatedAt: "2024-01-01T00:00:00Z",
    attachedAt: "2024-01-01T00:00:00Z",
    defaultBranch: "main",
    ...overrides,
  } as RepoRegistration;
}

describe("isDeveloperOnlyRepo", () => {
  it("returns true for managed_pack sourceKind", () => {
    expect(isDeveloperOnlyRepo(makeRepo({ sourceKind: "managed_pack" }))).toBe(true);
  });

  it("returns true for managed_demo_pack sourceKind", () => {
    expect(isDeveloperOnlyRepo(makeRepo({ sourceKind: "managed_demo_pack" as RepoRegistration["sourceKind"] }))).toBe(true);
  });

  it("returns true when developerOnly is set", () => {
    expect(isDeveloperOnlyRepo(makeRepo({ developerOnly: true }))).toBe(true);
  });

  it("returns true when hiddenFromPrimaryList is set", () => {
    expect(isDeveloperOnlyRepo(makeRepo({ hiddenFromPrimaryList: true }))).toBe(true);
  });

  it("returns false for normal repos", () => {
    expect(isDeveloperOnlyRepo(makeRepo())).toBe(false);
  });
});

describe("getVisibleRepos", () => {
  it("filters developer-only repos when labsMode is false", () => {
    const repos = [
      makeRepo({ id: "r1", displayName: "visible", sourceUri: "/visible" }),
      makeRepo({ id: "r2", displayName: "hidden", sourceUri: "/hidden", sourceKind: "managed_pack" }),
    ];
    const result = getVisibleRepos(repos, false);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("r1");
  });

  it("includes all repos when labsMode is true", () => {
    const repos = [
      makeRepo({ id: "r1", displayName: "visible", sourceUri: "/visible" }),
      makeRepo({ id: "r2", displayName: "hidden", sourceUri: "/hidden", sourceKind: "managed_pack" }),
    ];
    const result = getVisibleRepos(repos, true);
    expect(result).toHaveLength(2);
  });

  it("deduplicates by GitHub URL keeping the most recent", () => {
    const repos = [
      makeRepo({
        id: "r1",
        sourceUri: "https://github.com/owner/repo.git",
        updatedAt: "2024-01-01T00:00:00Z",
      }),
      makeRepo({
        id: "r2",
        sourceUri: "https://github.com/Owner/Repo",
        updatedAt: "2024-06-01T00:00:00Z",
      }),
    ];
    const result = getVisibleRepos(repos, false);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("r2");
  });

  it("sorts active repos first", () => {
    const repos = [
      makeRepo({ id: "r1", sourceUri: "/a", active: false, updatedAt: "2024-06-01T00:00:00Z" }),
      makeRepo({ id: "r2", sourceUri: "/b", active: true, updatedAt: "2024-01-01T00:00:00Z" }),
    ];
    const result = getVisibleRepos(repos, false);
    expect(result[0].id).toBe("r2");
    expect(result[1].id).toBe("r1");
  });

  it("sorts by updatedAt within same active status", () => {
    const repos = [
      makeRepo({ id: "r1", sourceUri: "/a", active: true, updatedAt: "2024-01-01T00:00:00Z" }),
      makeRepo({ id: "r2", sourceUri: "/b", active: true, updatedAt: "2024-06-01T00:00:00Z" }),
    ];
    const result = getVisibleRepos(repos, false);
    expect(result[0].id).toBe("r2");
    expect(result[1].id).toBe("r1");
  });
});

describe("getRecentRepos", () => {
  it("limits results to specified count", () => {
    const repos = Array.from({ length: 15 }, (_, i) =>
      makeRepo({ id: `r${i}`, sourceUri: `/repo-${i}`, updatedAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
    );
    const result = getRecentRepos(repos, false, 5);
    expect(result).toHaveLength(5);
  });

  it("defaults limit to 8", () => {
    const repos = Array.from({ length: 15 }, (_, i) =>
      makeRepo({ id: `r${i}`, sourceUri: `/repo-${i}`, updatedAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` })
    );
    const result = getRecentRepos(repos, false);
    expect(result).toHaveLength(8);
  });

  it("returns all if fewer repos than limit", () => {
    const repos = [
      makeRepo({ id: "r1", sourceUri: "/a" }),
      makeRepo({ id: "r2", sourceUri: "/b" }),
    ];
    const result = getRecentRepos(repos, false, 8);
    expect(result).toHaveLength(2);
  });
});
