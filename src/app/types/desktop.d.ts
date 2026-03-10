export {};

declare global {
  interface Window {
    desktopBridge?: {
      getApiConfig: () => Promise<{ baseUrl: string; token: string; apiReady?: boolean }>;
      getPreflight: () => Promise<{
        checks: Array<{ key: string; ok: boolean; message: string; severity: "warning" | "error" }>;
        apiReady: boolean;
        checkedAt: string;
      }>;
      pickRepoDirectory?: () => Promise<{ canceled: boolean; path?: string }>;
      listRecentRepoPaths?: () => Promise<Array<{ path: string; label: string; lastUsedAt: string }>>;
      rememberRepoPath?: (path: string, label?: string) => Promise<void>;
    };
  }
}
