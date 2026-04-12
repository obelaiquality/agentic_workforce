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

// --- Interactive terminal bridge ---
const terminalDataListeners = new Set();

ipcRenderer.on("terminal:data", (_event, data) => {
  for (const listener of terminalDataListeners) {
    listener(data);
  }
});

contextBridge.exposeInMainWorld("electronTerminal", {
  spawn: async () => ipcRenderer.invoke("terminal:spawn"),
  write: async (data) => ipcRenderer.invoke("terminal:input", data),
  resize: async (cols, rows) => ipcRenderer.invoke("terminal:resize", cols, rows),
  kill: async () => ipcRenderer.invoke("terminal:kill"),
  onData: (callback) => {
    terminalDataListeners.add(callback);
    return () => {
      terminalDataListeners.delete(callback);
    };
  },
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
