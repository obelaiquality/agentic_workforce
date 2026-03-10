import type { RepoRegistration } from "../../shared/contracts";

function sourceKey(repo: RepoRegistration) {
  const raw = repo.sourceUri?.trim() || repo.displayName;

  try {
    const parsed = new URL(raw);
    if (parsed.hostname === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[0].toLowerCase();
        const name = parts[1].replace(/\.git$/i, "").toLowerCase();
        return `github:${owner}/${name}`;
      }
    }
  } catch {
    // Not a URL; fall through to source-kind-specific keys.
  }

  return `${repo.sourceKind}:${raw}`;
}

export function isDeveloperOnlyRepo(repo: RepoRegistration) {
  return (
    repo.sourceKind === "managed_pack" ||
    repo.sourceKind === "managed_demo_pack" ||
    Boolean(repo.developerOnly) ||
    Boolean(repo.hiddenFromPrimaryList)
  );
}

export function getVisibleRepos(repos: RepoRegistration[], labsMode: boolean) {
  const filtered = repos.filter((repo) => (labsMode ? true : !isDeveloperOnlyRepo(repo)));
  const deduped = new Map<string, RepoRegistration>();

  for (const repo of filtered) {
    const key = sourceKey(repo);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, repo);
      continue;
    }

    const existingUpdated = new Date(existing.updatedAt).getTime();
    const nextUpdated = new Date(repo.updatedAt).getTime();
    if (!existing.active && repo.active) {
      deduped.set(key, repo);
      continue;
    }
    if (nextUpdated > existingUpdated) {
      deduped.set(key, repo);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.active !== b.active) {
      return a.active ? -1 : 1;
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function getRecentRepos(repos: RepoRegistration[], labsMode: boolean, limit = 8) {
  return getVisibleRepos(repos, labsMode).slice(0, limit);
}
