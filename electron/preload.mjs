import { contextBridge, ipcRenderer } from "electron";

const streamListeners = new Map();

ipcRenderer.on("desktop:stream-event", (_event, payload) => {
  const listeners = streamListeners.get(payload?.streamId);
  if (!listeners) {
    return;
  }
  for (const listener of listeners.values()) {
    listener({
      event: payload.event,
      data: typeof payload.data === "string" ? payload.data : "",
    });
  }
});

contextBridge.exposeInMainWorld("desktopBridge", {
  apiRequest: async (request) => ipcRenderer.invoke("desktop:api-request", request),
  openStream: async (request) => ipcRenderer.invoke("desktop:open-stream", request),
  onStreamEvent: (streamId, handler) => {
    const listeners = streamListeners.get(streamId) ?? new Map();
    const listenerId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    listeners.set(listenerId, handler);
    streamListeners.set(streamId, listeners);
    return () => {
      const active = streamListeners.get(streamId);
      if (!active) {
        return;
      }
      active.delete(listenerId);
      if (active.size === 0) {
        streamListeners.delete(streamId);
      }
    };
  },
  closeStream: async (streamId) => ipcRenderer.invoke("desktop:close-stream", streamId),
  openExternal: async (url) => ipcRenderer.invoke("desktop:open-external", url),
  getPreflight: async () => ipcRenderer.invoke("desktop:get-preflight"),
  pickRepoDirectory: async () => ipcRenderer.invoke("desktop:pick-repo-directory"),
  listRecentRepoPaths: async () => ipcRenderer.invoke("desktop:list-recent-repos"),
  rememberRepoPath: async (path, label) => ipcRenderer.invoke("desktop:remember-repo-path", { path, label }),
});
