import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopBridge", {
  getApiConfig: async () => ipcRenderer.invoke("desktop:get-api-config"),
  getPreflight: async () => ipcRenderer.invoke("desktop:get-preflight"),
  pickRepoDirectory: async () => ipcRenderer.invoke("desktop:pick-repo-directory"),
  listRecentRepoPaths: async () => ipcRenderer.invoke("desktop:list-recent-repos"),
  rememberRepoPath: async (path, label) => ipcRenderer.invoke("desktop:remember-repo-path", { path, label }),
});
