"use strict";

// AI Bridge (Task A3) — Shop PC side of docs/ai-assistant/BRIDGE_PROTOCOL.md, in Electron main.
//
// SAFETY (docs/ai-assistant/SAFETY_RULES.md):
//   S-1.1/S-1.2  no import of Relay, Hardware, billing, payment, firmware, signing, OTA, drivers or the
//                POS store; data comes only from the backend's read-only GET route. Enforced by
//                tests/ai-bridge-import-boundary.test.js.
//   S-1.3        unknown Cloud messages are ignored + logged (connection.js).
//   S-1.5        Disconnect deletes the local token (and tells the Cloud when online).
//   S-2.1        every snapshot passes the strict Snapshot schema before it is sent.
//   S-5.2        the device token is stored only with safeStorage (token-store.js).
const path = require("node:path");
const { createTokenStore } = require("./token-store");
const { createConfigStore, ShopInfo, TableKinds } = require("./config-store");
const { createOutbox } = require("./outbox");
const { createFileLogger } = require("./logger");
const { BridgeConnection } = require("./connection");
const { createSnapshotScheduler } = require("./scheduler");
const { buildSnapshot } = require("./snapshot-builder");

const PAIRING_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

class AiBridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** https only, except http://localhost for development against a local cloud-hub. */
function normalizeHubBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new AiBridgeError("HUB_URL_INVALID", "ที่อยู่ Cloud hub ไม่ถูกต้อง"); }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new AiBridgeError("HUB_URL_INSECURE", "ที่อยู่ Cloud hub ต้องเป็น https://");
  if (url.username || url.password || url.search || url.hash) throw new AiBridgeError("HUB_URL_INVALID", "ที่อยู่ Cloud hub ไม่ถูกต้อง");
  return url.origin;
}

/** The hub may only send us to its own host, over wss (ws only for local development). */
function checkWsUrl(hubUrl, hubBaseUrl) {
  let ws, base;
  try { ws = new URL(hubUrl); base = new URL(hubBaseUrl); } catch { throw new AiBridgeError("HUB_WS_URL_INVALID", "Cloud hub ตอบที่อยู่ไม่ถูกต้อง"); }
  const local = LOCAL_HOSTS.has(base.hostname);
  const okProtocol = ws.protocol === "wss:" || (local && ws.protocol === "ws:");
  if (!okProtocol || ws.hostname !== base.hostname || ws.pathname !== "/bridge/v1") throw new AiBridgeError("HUB_WS_URL_INVALID", "Cloud hub ตอบที่อยู่ไม่ถูกต้อง");
  return local ? `${ws.protocol}//${base.host}/bridge/v1` : ws.toString();
}

class AiBridge {
  /**
   * @param {{ configDir: string, logsDir: string, safeStorage: any, WebSocket: any, appVersion: string,
   *   fetchSource: () => Promise<object>, fetchImpl?: typeof fetch, logger?: any, now?: () => Date,
   *   connectionOptions?: object }} options
   */
  constructor({ configDir, logsDir, safeStorage, WebSocket, appVersion, fetchSource, fetchImpl = globalThis.fetch, logger, now = () => new Date(), connectionOptions = {} }) {
    this.tokens = createTokenStore({ file: path.join(configDir, "ai-bridge-token.bin"), safeStorage });
    this.config = createConfigStore({ file: path.join(configDir, "ai-bridge.json") });
    this.outbox = createOutbox({ file: path.join(configDir, "ai-bridge-outbox.json") });
    this.logger = logger || createFileLogger(path.join(logsDir, "ai-bridge.log"));
    Object.assign(this, { WebSocket, appVersion, fetchSource, fetchImpl, now, connectionOptions });
    this.connection = null;
    this.lastSeq = 0;
    this.lastSnapshotAt = null;
    this.lastError = null;
    this.scheduler = createSnapshotScheduler({
      fetchSource: () => this.fetchSource(),
      build: source => this.build(source),
      send: snapshot => {
        if (this.connection?.sendSnapshot(snapshot)) this.lastSnapshotAt = snapshot.generatedAt;
      },
      logger: this.logger,
    });
  }

  /** seq must keep growing across restarts (the Cloud drops a seq that is not newer). */
  nextSeq() {
    this.lastSeq = Math.max(this.lastSeq + 1, this.now().getTime());
    return this.lastSeq;
  }

  build(source) {
    const cfg = this.config.read();
    return buildSnapshot({ source, shopInfo: cfg.shopInfo, tableKinds: cfg.tableKinds, seq: this.nextSeq(), now: this.now() });
  }

  /** Called once at app start: reconnect if this PC is already paired. Never throws. */
  start() {
    try {
      const { device } = this.config.read();
      if (device && this.tokens.has()) this.connect(device);
    } catch (error) {
      this.logger.error("bridge.start_failed", { error: error.code || error.message });
    }
  }

  connect(device) {
    this.stopConnection();
    const connection = new BridgeConnection({
      WebSocket: this.WebSocket,
      hubUrl: device.hubUrl,
      deviceId: device.deviceId,
      appVersion: this.appVersion,
      getToken: () => this.tokens.load(),
      saveToken: token => this.tokens.save(token),
      outbox: this.outbox,
      logger: this.logger,
      ...this.connectionOptions,
    });
    connection.on("online", ({ snapshotIntervalSec }) => this.scheduler.start(snapshotIntervalSec));
    connection.on("offline", () => this.scheduler.stop());
    connection.on("revoked", () => {
      // Token is dead on the Cloud side (revoked by the owner): forget it here too.
      this.scheduler.stop();
      this.tokens.clear();
      this.config.update({ device: null });
      this.lastError = "REVOKED";
    });
    this.connection = connection;
    connection.start();
  }

  stopConnection() {
    this.scheduler.stop();
    if (this.connection) {
      this.connection.removeAllListeners();
      this.connection.stop();
      this.connection = null;
    }
  }

  status() {
    const cfg = this.config.read();
    const conn = this.connection?.status();
    return {
      paired: Boolean(cfg.device),
      deviceId: cfg.device?.deviceId || null,
      deviceName: cfg.device?.deviceName || null,
      hubBaseUrl: cfg.device?.hubBaseUrl || null,
      state: conn?.state || (cfg.device ? "stopped" : "not_paired"),
      lastError: conn?.lastError || this.lastError,
      lastSnapshotAt: this.lastSnapshotAt,
      pendingOutbox: this.outbox.size(),
      safeStorageAvailable: this.tokens.available(),
      shopInfo: cfg.shopInfo,
      tableKinds: cfg.tableKinds,
    };
  }

  saveShopInfo({ shopInfo, tableKinds } = {}) {
    const changes = {};
    if (shopInfo !== undefined) {
      const parsed = ShopInfo.safeParse(shopInfo);
      if (!parsed.success) throw new AiBridgeError("SHOP_INFO_INVALID", "เวลาเปิด-ปิดไม่ถูกต้อง (HH:MM) หรือ note ยาวเกิน 200 ตัวอักษร");
      changes.shopInfo = parsed.data;
    }
    if (tableKinds !== undefined) {
      const parsed = TableKinds.safeParse(tableKinds);
      if (!parsed.success) throw new AiBridgeError("TABLE_KINDS_INVALID", "ประเภทโต๊ะไม่ถูกต้อง");
      changes.tableKinds = parsed.data;
    }
    this.config.update(changes);
    if (this.scheduler.isRunning()) this.scheduler.sendNow("settings_changed");
    return this.status();
  }

  /** BRIDGE_PROTOCOL §2 steps 2–5. Gate G1 applies before doing this against the real shop PC. */
  async pair({ hubBaseUrl, pairingCode, deviceName } = {}) {
    const base = normalizeHubBaseUrl(hubBaseUrl);
    const code = String(pairingCode || "").trim().toUpperCase();
    const name = String(deviceName || "").trim();
    if (!PAIRING_CODE.test(code)) throw new AiBridgeError("PAIRING_CODE_INVALID", "pairing code ต้องเป็น 8 ตัว (A–Z, 2–9)");
    if (!name || name.length > 60) throw new AiBridgeError("DEVICE_NAME_INVALID", "กรุณาตั้งชื่อเครื่อง (ไม่เกิน 60 ตัวอักษร)");
    if (!this.config.read().shopInfo) throw new AiBridgeError("SHOP_HOURS_NOT_SET", "กรุณาตั้งเวลาเปิด-ปิดร้านก่อนเชื่อมต่อ");
    if (!this.tokens.available()) throw new AiBridgeError("SAFE_STORAGE_UNAVAILABLE", "เครื่องนี้เข้ารหัส token ไม่ได้ จึงเชื่อมต่อไม่ได้");
    if (this.config.read().device) throw new AiBridgeError("ALREADY_PAIRED", "เครื่องนี้เชื่อมต่ออยู่แล้ว กรุณาตัดการเชื่อมต่อก่อน");

    let res;
    try {
      res = await this.fetchImpl(`${base}/bridge/v1/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairingCode: code, deviceName: name, appVersion: this.appVersion }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      this.logger.warn("bridge.pair_network_failed", { error: error.code || error.name });
      throw new AiBridgeError("HUB_UNREACHABLE", "ติดต่อ Cloud hub ไม่ได้ ตรวจสอบอินเทอร์เน็ต");
    }
    if (!res.ok) {
      this.logger.warn("bridge.pair_refused", { status: res.status });
      const message = res.status === 429 ? "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่" : res.status === 503 ? "Cloud ปิดการเชื่อมต่อ bridge อยู่" : "pairing code ไม่ถูกต้องหรือหมดอายุ";
      throw new AiBridgeError(`PAIR_HTTP_${res.status}`, message);
    }
    const body = await res.json().catch(() => null);
    if (!body || !/^dev_[A-Za-z0-9_-]{1,60}$/.test(body.deviceId) || !/^[A-Za-z0-9_-]{43}$/.test(body.deviceToken)) {
      throw new AiBridgeError("PAIR_RESPONSE_INVALID", "Cloud hub ตอบกลับไม่ถูกต้อง");
    }
    const hubUrl = checkWsUrl(body.hubUrl, base);
    this.tokens.save(body.deviceToken); // throws (and nothing is stored) if safeStorage fails
    const device = { deviceId: body.deviceId, deviceName: name, hubUrl, hubBaseUrl: base, pairedAt: this.now().toISOString() };
    this.config.update({ device });
    this.lastError = null;
    this.logger.info("bridge.paired", { deviceId: device.deviceId });
    this.connect(device);
    return this.status();
  }

  /** S-1.5: Disconnect = stop + tell the Cloud (best effort) + delete the local token. Never throws on network errors. */
  async disconnect() {
    const { device } = this.config.read();
    const token = this.tokens.load();
    this.stopConnection();
    let cloudNotified = false;
    if (device && token) {
      try {
        const res = await this.fetchImpl(`${device.hubBaseUrl}/bridge/v1/unpair`, { method: "POST", headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
        cloudNotified = res.ok;
      } catch {
        cloudNotified = false;
      }
    }
    this.tokens.clear();
    this.outbox.clear();
    this.config.update({ device: null });
    this.lastError = null;
    this.logger.info("bridge.disconnected", { cloudNotified });
    return { ...this.status(), cloudNotified };
  }

  /** For A6 (Approval tab): queue a decision; it is sent now or after reconnect. */
  enqueueDecision(payload) {
    if (!this.connection) throw new AiBridgeError("NOT_PAIRED", "ยังไม่ได้เชื่อมต่อ AI Bridge");
    return this.connection.enqueueDecision(payload);
  }

  shutdown() {
    this.stopConnection();
  }
}

module.exports = { AiBridge, AiBridgeError, normalizeHubBaseUrl, checkWsUrl };
