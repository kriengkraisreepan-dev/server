const { contextBridge, ipcRenderer } = require("electron");
const channels = Object.freeze({ appInfo: "lucky-desktop:app-info", runtimeStatus: "lucky-desktop:runtime-status", backupExport: "lucky-desktop:backup-export" });
contextBridge.exposeInMainWorld("luckyDesktop", Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(channels.appInfo),
  getRuntimeStatus: () => ipcRenderer.invoke(channels.runtimeStatus),
  exportBackup: fileName => ipcRenderer.invoke(channels.backupExport, { fileName })
}));
