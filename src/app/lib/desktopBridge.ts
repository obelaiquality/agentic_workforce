export interface RecentRepoPath {
  path: string;
  label: string;
  lastUsedAt: string;
}

export function hasDesktopRepoPicker() {
  return typeof window !== "undefined" && Boolean(window.desktopBridge?.pickRepoDirectory);
}

export async function pickRepoDirectory() {
  if (!window.desktopBridge?.pickRepoDirectory) {
    return { canceled: true } as const;
  }
  return window.desktopBridge.pickRepoDirectory();
}

export async function listRecentRepoPaths(): Promise<RecentRepoPath[]> {
  if (!window.desktopBridge?.listRecentRepoPaths) {
    return [];
  }
  return window.desktopBridge.listRecentRepoPaths();
}

export async function rememberRepoPath(path: string, label?: string) {
  if (!window.desktopBridge?.rememberRepoPath) {
    return;
  }
  await window.desktopBridge.rememberRepoPath(path, label);
}
