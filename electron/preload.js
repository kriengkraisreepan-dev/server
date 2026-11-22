const { contextBridge, ipcRenderer } = require("electron");
const channels = Object.freeze({ appInfo: "lucky-desktop:app-info", runtimeStatus: "lucky-desktop:runtime-status", backupExport: "lucky-desktop:backup-export", aiBridgeStatus: "lucky-desktop:ai-bridge-status", aiBridgePair: "lucky-desktop:ai-bridge-pair", aiBridgeDisconnect: "lucky-desktop:ai-bridge-disconnect", aiBridgeSaveShopInfo: "lucky-desktop:ai-bridge-save-shop-info" });
contextBridge.exposeInMainWorld("luckyDesktop", Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(channels.appInfo),
  getRuntimeStatus: () => ipcRenderer.invoke(channels.runtimeStatus),
  exportBackup: fileName => ipcRenderer.invoke(channels.backupExport, { fileName }),
  // Settings → AI Bridge (Task A3). Main re-checks the caller is OWNER/MANAGER on every call.
  aiBridge: Object.freeze({
    status: () => ipcRenderer.invoke(channels.aiBridgeStatus),
    pair: ({ hubBaseUrl, pairingCode, deviceName }) => ipcRenderer.invoke(channels.aiBridgePair, { hubBaseUrl, pairingCode, deviceName }),
    disconnect: () => ipcRenderer.invoke(channels.aiBridgeDisconnect),
    saveShopInfo: ({ shopInfo, tableKinds }) => ipcRenderer.invoke(channels.aiBridgeSaveShopInfo, { shopInfo, tableKinds })
  })
}));
