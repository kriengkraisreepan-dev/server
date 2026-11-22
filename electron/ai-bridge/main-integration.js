"use strict";

// Wires the AI Bridge into Electron main: builds it and installs the 4 Settings → AI Bridge IPC
// handlers. Electron objects are passed in (this file never loads the electron module itself) so this is testable.
//
// Every IPC call is checked twice: the sender frame must be our own origin (validateSender), and the
// logged-in user — looked up from the renderer's own session cookie via the backend's
// `GET /api/auth/me` — must be OWNER or MANAGER. Hiding the tab in the UI is not the check.
const WebSocket = require("ws");
const { AiBridge } = require("./index");
const { createSourceClient } = require("./source-client");

const ALLOWED_ROLES = new Set(["OWNER", "MANAGER"]);
const SESSION_COOKIE = "lucky_session";

function ipcError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function currentRole({ session, origin, fetchImpl }) {
  const cookies = await session.cookies.get({ url: origin, name: SESSION_COOKIE });
  const value = cookies[0]?.value;
  if (!value) return null;
  const res = await fetchImpl(`${origin}/api/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${value}` }, signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.user?.role || null;
}

function installAiBridge({ ipcMain, session, safeStorage, layout, origin, sourceKey, appVersion, channels, validateSender, fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket }) {
  const bridge = new AiBridge({
    configDir: layout.config,
    logsDir: layout.logs,
    safeStorage,
    WebSocket: WebSocketImpl,
    appVersion,
    fetchSource: createSourceClient({ baseUrl: origin, key: sourceKey, fetchImpl }),
    fetchImpl,
  });

  const guarded = handler => async (event, ...args) => {
    if (!validateSender(event, origin) || args.length > 1) throw ipcError("IPC_REQUEST_REJECTED", "IPC request rejected");
    const role = await currentRole({ session, origin, fetchImpl }).catch(() => null);
    if (!ALLOWED_ROLES.has(role)) throw ipcError("FORBIDDEN", "เฉพาะเจ้าของหรือผู้จัดการเท่านั้น");
    try {
      return await handler(args[0]);
    } catch (error) {
      // Only our own code + Thai message cross IPC; never a stack or a token.
      throw ipcError(error.code || "AI_BRIDGE_ERROR", error.code ? error.message : "AI Bridge ทำงานผิดพลาด");
    }
  };
  const plain = request => (request && typeof request === "object" && !Array.isArray(request) ? request : {});

  ipcMain.handle(channels.AI_BRIDGE_STATUS, guarded(() => bridge.status()));
  ipcMain.handle(channels.AI_BRIDGE_PAIR, guarded(request => {
    const { hubBaseUrl, pairingCode, deviceName } = plain(request);
    return bridge.pair({ hubBaseUrl, pairingCode, deviceName });
  }));
  ipcMain.handle(channels.AI_BRIDGE_DISCONNECT, guarded(() => bridge.disconnect()));
  ipcMain.handle(channels.AI_BRIDGE_SAVE_SHOP_INFO, guarded(request => {
    const { shopInfo, tableKinds } = plain(request);
    return bridge.saveShopInfo({ shopInfo, tableKinds });
  }));
  return bridge;
}

module.exports = { installAiBridge, currentRole, ALLOWED_ROLES };
