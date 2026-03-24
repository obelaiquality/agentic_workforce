export interface RecentRepoPath {
  path: string;
  label: string;
  lastUsedAt: string;
}

export interface DesktopPreflightCheck {
  key: string;
  ok: boolean;
  message: string;
  severity: "warning" | "error";
}

export interface DesktopPreflightState {
  checks: DesktopPreflightCheck[];
  apiReady: boolean;
  checkedAt: string;
}

export interface DesktopApiRequest {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface DesktopApiResponse {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
}

export interface DesktopBridgeApi {
  apiRequest?: (request: DesktopApiRequest) => Promise<DesktopApiResponse>;
  openStream?: (request: { path: string; query?: Record<string, string | number | boolean | null | undefined> }) => Promise<{ streamId: string }>;
  onStreamEvent?: (streamId: string, handler: (event: { event: string; data: string }) => void) => () => void;
  closeStream?: (streamId: string) => Promise<void>;
  openExternal?: (url: string) => Promise<{ ok: boolean }>;
  getPreflight?: () => Promise<DesktopPreflightState>;
  pickRepoDirectory?: () => Promise<{ canceled: boolean; path?: string }>;
  listRecentRepoPaths?: () => Promise<RecentRepoPath[]>;
  rememberRepoPath?: (path: string, label?: string) => Promise<void>;
}

export function getDesktopBridge(): DesktopBridgeApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as Window & { desktopBridge?: DesktopBridgeApi }).desktopBridge;
}

export function hasDesktopRepoPicker() {
  return Boolean(getDesktopBridge()?.pickRepoDirectory);
}

export async function pickRepoDirectory() {
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge?.pickRepoDirectory) {
    return { canceled: true } as const;
  }
  return desktopBridge.pickRepoDirectory();
}

export async function listRecentRepoPaths(): Promise<RecentRepoPath[]> {
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge?.listRecentRepoPaths) {
    return [];
  }
  return desktopBridge.listRecentRepoPaths();
}

export async function rememberRepoPath(path: string, label?: string) {
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge?.rememberRepoPath) {
    return;
  }
  await desktopBridge.rememberRepoPath(path, label);
}

export async function openDesktopExternal(url: string) {
  const desktopBridge = getDesktopBridge();
  if (!desktopBridge?.openExternal) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await desktopBridge.openExternal(url);
}
