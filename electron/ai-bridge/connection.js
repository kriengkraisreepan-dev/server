"use strict";

// WSS client for `/bridge/v1` (BRIDGE_PROTOCOL §3–5) — runs in Electron main, never in the backend.
//
// SAFETY S-1.1: nothing received here can reach the POS. The only things a Cloud message can do:
//   ack              → drop the matching item from the local outbox
//   approval.created → emit an event (A6 shows it to staff) + ack
//   approval.updated → emit an event + ack
//   token.rotate     → store the new token (encrypted) + ack
//   hello.ack        → mark online, start heartbeat + snapshots
// S-1.3: anything else — unknown type, wrong direction, bad payload — does nothing and is logged
// as `bridge.unknown_message` / `bridge.rejected_message`.
// Errors here never throw into the caller: the shop keeps working when the network is down.
const { EventEmitter } = require("node:events");
const { parseMessage, serializeMessage, REJECT_CODES, MAX_MESSAGE_BYTES, PROTOCOL_VERSION } = require("../../packages/bridge-protocol");
const { reconnectDelay } = require("./backoff");
const { ulid } = require("./ids");

const HEARTBEAT_MS = 20 * 1000;
const ACK_TIMEOUT_MS = 10 * 1000;
const DEDUPE_LIMIT = 1000;
/** Cloud close code meaning "this token is revoked — do not reconnect with it" (cloud-hub CLOSE.REVOKED). */
const CLOSE_REVOKED = 4401;

class BridgeConnection extends EventEmitter {
  /**
   * @param {{ WebSocket: any, hubUrl: string, deviceId: string, appVersion: string,
   *   getToken: () => string | null, saveToken: (token: string) => void, outbox: any, logger: any,
   *   heartbeatMs?: number, ackTimeoutMs?: number, random?: () => number, delayFor?: (attempt: number) => number }} options
   */
  constructor({ WebSocket, hubUrl, deviceId, appVersion, getToken, saveToken, outbox, logger, heartbeatMs = HEARTBEAT_MS, ackTimeoutMs = ACK_TIMEOUT_MS, random = Math.random, delayFor }) {
    super();
    Object.assign(this, { WebSocket, hubUrl, deviceId, appVersion, getToken, saveToken, outbox, logger, heartbeatMs, ackTimeoutMs });
    this.delayFor = delayFor || (attempt => reconnectDelay(attempt, random));
    this.state = "stopped";
    this.ws = null;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pendingAcks = new Map();
    this.seen = new Set();
    this.lastError = null;
    this.snapshotIntervalSec = 30;
  }

  start() {
    if (this.state !== "stopped" && this.state !== "revoked") return;
    this.state = "connecting";
    this.connect();
  }

  stop() {
    this.state = "stopped";
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try { ws.removeAllListeners(); ws.on("error", () => {}); ws.close(1000, "shop disconnect"); } catch { /* ignore */ }
      setTimeout(() => { try { ws.terminate(); } catch { /* ignore */ } }, 1000).unref?.();
    }
    this.emit("state", this.state);
  }

  status() {
    return { state: this.state, attempt: this.attempt, lastError: this.lastError, pendingOutbox: this.outbox.size() };
  }

  clearTimers() {
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    for (const timer of this.pendingAcks.values()) clearTimeout(timer);
    this.pendingAcks.clear();
    this.reconnectTimer = this.heartbeatTimer = null;
  }

  connect() {
    const token = this.getToken();
    if (!token) {
      this.lastError = "NO_TOKEN";
      this.logger.warn("bridge.no_token");
      this.state = "revoked";
      this.emit("state", this.state);
      return;
    }
    let ws;
    try {
      ws = new this.WebSocket(this.hubUrl, { headers: { Authorization: `Bearer ${token}` }, maxPayload: MAX_MESSAGE_BYTES, handshakeTimeout: 15000 });
    } catch (error) {
      this.lastError = error.code || "CONNECT_FAILED";
      this.logger.warn("bridge.connect_failed", { error: this.lastError });
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.on("open", () => {
      if (this.ws !== ws) return;
      this.sendRaw("hello", { deviceId: this.deviceId, appVersion: this.appVersion, protocolVersion: PROTOCOL_VERSION, timezone: "Asia/Bangkok" });
    });
    ws.on("message", data => {
      if (this.ws !== ws) return;
      try { this.onMessage(data); } catch (error) { this.logger.error("bridge.handler_failed", { error: error.message }); }
    });
    ws.on("unexpected-response", (_req, res) => {
      if (this.ws !== ws) return;
      this.lastError = `HTTP_${res.statusCode}`;
      this.logger.warn("bridge.upgrade_refused", { status: res.statusCode });
      if (res.statusCode === 401) this.revoked();
      try { ws.terminate(); } catch { /* ignore */ }
    });
    ws.on("error", error => {
      if (this.ws !== ws) return;
      this.lastError = error.code || "SOCKET_ERROR";
      this.logger.warn("bridge.socket_error", { error: this.lastError });
    });
    ws.on("close", code => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.heartbeatTimer);
      for (const timer of this.pendingAcks.values()) clearTimeout(timer);
      this.pendingAcks.clear();
      if (this.state === "stopped" || this.state === "revoked") return;
      if (code === CLOSE_REVOKED) return this.revoked();
      this.logger.info("bridge.closed", { code });
      this.scheduleReconnect();
    });
  }

  revoked() {
    this.clearTimers();
    this.state = "revoked";
    this.logger.warn("bridge.revoked");
    this.emit("state", this.state);
    this.emit("revoked");
  }

  scheduleReconnect() {
    if (this.state === "stopped" || this.state === "revoked") return;
    const wasOnline = this.state === "online";
    this.state = "offline";
    if (wasOnline) this.emit("offline");
    this.emit("state", this.state);
    const delay = this.delayFor(this.attempt);
    this.attempt += 1;
    this.logger.info("bridge.reconnect_scheduled", { attempt: this.attempt, delayMs: delay });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.state !== "offline") return;
      this.state = "connecting";
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  /** Serialize (strict, S-2.1) and send. Returns the envelope id, or null when not connected. */
  sendRaw(type, payload, id = ulid()) {
    const frame = serializeMessage(type, payload, { direction: "shop_to_cloud", id });
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return null;
    ws.send(frame);
    return id;
  }

  /** Send a snapshot when online. Throws only if the snapshot breaks the schema. */
  sendSnapshot(snapshot) {
    if (this.state !== "online") return null;
    return this.sendRaw("snapshot", snapshot);
  }

  /**
   * Queue an `approval.decision` (persisted) and send it now if online (BRIDGE_PROTOCOL §3).
   * Used by the Approval tab in A6.
   */
  enqueueDecision(payload) {
    const id = ulid();
    const ts = new Date().toISOString();
    serializeMessage("approval.decision", payload, { direction: "shop_to_cloud", id, ts }); // validate first
    this.outbox.add({ id, type: "approval.decision", ts, payload });
    if (this.state === "online") this.deliverQueued({ id, type: "approval.decision", payload });
    return id;
  }

  deliverQueued(item) {
    if (this.state !== "online") return;
    if (this.sendRaw(item.type, item.payload, item.id) === null) return;
    clearTimeout(this.pendingAcks.get(item.id));
    const timer = setTimeout(() => {
      this.pendingAcks.delete(item.id);
      if (this.outbox.list().some(x => x.id === item.id)) this.deliverQueued(item);
    }, this.ackTimeoutMs);
    timer.unref?.();
    this.pendingAcks.set(item.id, timer);
  }

  flushOutbox() {
    for (const item of this.outbox.list()) this.deliverQueued(item);
  }

  ack(refId) {
    try { this.sendRaw("ack", { refId }); } catch (error) { this.logger.warn("bridge.ack_failed", { error: error.message }); }
  }

  firstTime(id) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > DEDUPE_LIMIT) this.seen.delete(this.seen.values().next().value);
    return true;
  }

  onMessage(data) {
    const r = parseMessage(data, { direction: "cloud_to_shop" });
    if (!r.ok) {
      // S-1.3: do nothing, log code/type/id only (never the payload values).
      const event = r.code === REJECT_CODES.UNKNOWN_TYPE ? "bridge.unknown_message" : "bridge.rejected_message";
      this.logger.warn(event, { code: r.code, type: r.type, id: r.id });
      this.emit("rejected", { code: r.code, type: r.type });
      return;
    }
    const msg = r.message;
    switch (msg.type) {
      case "hello.ack": {
        this.state = "online";
        this.attempt = 0;
        this.lastError = null;
        this.snapshotIntervalSec = msg.payload.snapshotIntervalSec;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
          try { this.sendRaw("heartbeat", {}); } catch { /* ignore */ }
        }, this.heartbeatMs);
        this.heartbeatTimer.unref?.();
        this.logger.info("bridge.online", { snapshotIntervalSec: this.snapshotIntervalSec });
        this.emit("state", this.state);
        this.emit("online", { snapshotIntervalSec: this.snapshotIntervalSec });
        this.flushOutbox();
        return;
      }
      case "ack": {
        clearTimeout(this.pendingAcks.get(msg.payload.refId));
        this.pendingAcks.delete(msg.payload.refId);
        if (this.outbox.remove(msg.payload.refId)) this.emit("delivered", msg.payload.refId);
        return;
      }
      case "approval.created":
      case "approval.updated": {
        if (this.firstTime(msg.id)) this.emit(msg.type, msg.payload);
        this.ack(msg.id); // re-ack a duplicate so the Cloud stops resending (§4)
        return;
      }
      case "token.rotate": {
        if (this.firstTime(msg.id)) {
          try {
            this.saveToken(msg.payload.newToken);
          } catch (error) {
            this.seen.delete(msg.id);
            this.logger.error("bridge.token_rotate_failed", { error: error.code || error.message });
            return; // no ack: the Cloud resends and the old token keeps working for 5 minutes
          }
          this.logger.info("bridge.token_rotated");
          this.emit("token.rotate");
        }
        this.ack(msg.id);
        return;
      }
      default:
        // Unreachable while parseMessage enforces the allowlist; fail-safe.
        this.logger.warn("bridge.unknown_message", { type: msg.type, id: msg.id });
    }
  }
}

module.exports = { BridgeConnection, CLOSE_REVOKED, HEARTBEAT_MS, ACK_TIMEOUT_MS };
