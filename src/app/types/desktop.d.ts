export {};

declare global {
  interface Window {
    desktopBridge?: {
      apiRequest?: (request: {
        method?: string;
        path: string;
        query?: Record<string, string | number | boolean | null | undefined>;
        body?: unknown;
        headers?: Record<string, string>;
      }) => Promise<{
        ok: boolean;
        status: number;
        body?: unknown;
        text?: string;
      }>;
      openStream?: (request: {
        path: string;
        query?: Record<string, string | number | boolean | null | undefined>;
      }) => Promise<{ streamId: string }>;
      onStreamEvent?: (streamId: string, handler: (event: { event: string; data: string }) => void) => () => void;
      closeStream?: (streamId: string) => Promise<void>;
      openExternal?: (url: string) => Promise<{ ok: boolean }>;
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
