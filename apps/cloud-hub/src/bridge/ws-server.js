'use strict';

// WSS endpoint `/bridge/v1` (BRIDGE_PROTOCOL §3, §5).
// The hub only ever *sends* the Cloud → Shop allowlist and only *accepts* the Shop → Cloud
// allowlist; everything else is rejected and logged (S-1.3). Nothing here can reach POS data.
const { WebSocketServer } = require('ws');
const { parseMessage, serializeMessage, MAX_MESSAGE_BYTES, ACK_REQUIRED } = require('@88snooker/bridge-protocol');
const ids = require('../ids');

const BRIDGE_PATH = '/bridge/v1';
const SNAPSHOT_INTERVAL_SEC = 30;
const DEDUPE_WINDOW = 1000;

/** Close codes the Shop PC can act on. 4401 = do not reconnect with this token. */
const CLOSE = Object.freeze({
  REVOKED: 4401,
  DEVICE_MISMATCH: 4403,
  HEARTBEAT_TIMEOUT: 4408,
  REPLACED: 4409,
  BRIDGE_DISABLED: 4503,
});

function rejectUpgrade(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function bearer(req) {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(h.trim());
  return m ? m[1] : null;
}

/** Remembers the last N message ids per device so a resent message is processed once (§4). */
function createDedupe(limit = DEDUPE_WINDOW) {
  const perDevice = new Map();
  return {
    /** @returns {boolean} true the first time this id is seen for this device */
    first(deviceId, id) {
      let seen = perDevice.get(deviceId);
      if (!seen) perDevice.set(deviceId, (seen = new Set()));
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > limit) seen.delete(seen.values().next().value);
      return true;
    },
    forget(deviceId) {
      perDevice.delete(deviceId);
    },
  };
}

function createBridgeServer({
  devices,
  snapshots,
  audit,
  killSwitches,
  logger,
  onDecision = async () => {},
  heartbeatTimeoutMs = 60 * 1000,
  ackTimeoutMs = 10 * 1000,
  maxSendAttempts = 3,
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  /** deviceId → connection state (one live connection per device) */
  const live = new Map();
  const dedupe = createDedupe();

  async function handleUpgrade(req, socket, head) {
    let url;
    try {
      url = new URL(req.url, 'http://hub');
    } catch {
      return rejectUpgrade(socket, 400, 'Bad Request');
    }
    if (url.pathname !== BRIDGE_PATH) return rejectUpgrade(socket, 404, 'Not Found');
    try {
      if (!(await killSwitches.isEnabled('bridge'))) return rejectUpgrade(socket, 503, 'Service Unavailable');
      // §3: token only in the Authorization header, never in the URL (it would land in proxy logs).
      const device = await devices.authenticate(bearer(req));
      if (!device) {
        logger.warn('bridge.auth_rejected', { ip: req.socket.remoteAddress });
        return rejectUpgrade(socket, 401, 'Unauthorized');
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, device));
    } catch (err) {
      logger.error('bridge.upgrade_failed', { error: err.message });
      rejectUpgrade(socket, 500, 'Internal Server Error');
    }
  }

  function onConnection(ws, device) {
    const { deviceId } = device;
    const previous = live.get(deviceId);
    if (previous) closeConn(previous, CLOSE.REPLACED, 'replaced by a new connection');

    const conn = { ws, deviceId, helloDone: false, heartbeatTimer: null, pending: new Map(), queue: Promise.resolve() };
    live.set(deviceId, conn);
    armHeartbeat(conn);

    ws.on('message', (data) => {
      // Process strictly in order per connection.
      conn.queue = conn.queue.then(() => onMessage(conn, data)).catch((err) => {
        logger.error('bridge.handler_failed', { deviceId, error: err.message });
      });
    });
    ws.on('close', () => {
      clearTimeout(conn.heartbeatTimer);
      for (const p of conn.pending.values()) clearTimeout(p.timer);
      if (live.get(deviceId) === conn) {
        live.delete(deviceId);
        audit.record({ actor: `device:${deviceId}`, action: 'device.disconnected', target: deviceId }).catch(() => {});
      }
    });
    ws.on('error', (err) => logger.warn('bridge.socket_error', { deviceId, error: err.message }));
  }

  function armHeartbeat(conn) {
    clearTimeout(conn.heartbeatTimer);
    conn.heartbeatTimer = setTimeout(() => {
      logger.warn('bridge.heartbeat_timeout', { deviceId: conn.deviceId });
      closeConn(conn, CLOSE.HEARTBEAT_TIMEOUT, 'heartbeat timeout');
    }, heartbeatTimeoutMs);
    conn.heartbeatTimer.unref?.();
  }

  async function onMessage(conn, data) {
    const { deviceId } = conn;
    const r = parseMessage(data, { direction: 'shop_to_cloud' });
    if (!r.ok) {
      // S-1.3: reject + log. Only code/type/id, never payload values.
      logger.warn('bridge.rejected_message', { deviceId, code: r.code, type: r.type, id: r.id });
      return;
    }
    const msg = r.message;
    armHeartbeat(conn);

    if (!conn.helloDone && msg.type !== 'hello') {
      logger.warn('bridge.before_hello', { deviceId, type: msg.type, id: msg.id });
      return;
    }

    if (!dedupe.first(deviceId, msg.id)) {
      // Already processed: re-ack so the sender stops retrying, but do not act again (§4, test §9).
      logger.info('bridge.duplicate_message', { deviceId, type: msg.type, id: msg.id });
      if (ACK_REQUIRED[msg.type] === 'ack') send(conn, 'ack', { refId: msg.id }, { track: false });
      return;
    }

    switch (msg.type) {
      case 'hello': {
        if (msg.payload.deviceId !== deviceId) {
          logger.warn('bridge.device_mismatch', { deviceId });
          closeConn(conn, CLOSE.DEVICE_MISMATCH, 'deviceId does not match token');
          return;
        }
        conn.helloDone = true;
        await devices.touch(deviceId);
        await audit.record({ actor: `device:${deviceId}`, action: 'device.connected', target: deviceId, detail: { appVersion: msg.payload.appVersion } });
        send(conn, 'hello.ack', { serverTime: new Date().toISOString(), snapshotIntervalSec: SNAPSHOT_INTERVAL_SEC }, { track: false });
        return;
      }
      case 'heartbeat':
        await devices.touch(deviceId);
        return;
      case 'snapshot': {
        const stored = await snapshots.store(deviceId, msg.payload);
        if (!stored) logger.info('bridge.snapshot_out_of_order', { deviceId, seq: msg.payload.seq });
        await devices.touch(deviceId);
        return;
      }
      case 'approval.decision': {
        // A2 has no approval queue yet (Phase B / A6): record and ack so the Shop clears its local queue.
        await onDecision(deviceId, msg);
        send(conn, 'ack', { refId: msg.id }, { track: false });
        return;
      }
      default:
        // Unreachable while parseMessage enforces the allowlist; kept as a fail-safe.
        logger.warn('bridge.unhandled_type', { deviceId, type: msg.type, id: msg.id });
    }
  }

  /**
   * Validate (strict) and send one Cloud → Shop message. Types that need an ack are resent
   * every ackTimeoutMs, up to maxSendAttempts. Note: protocol v1 has no Shop → Cloud `ack` in
   * its allowlist yet (open question for Gate G6), so today these are always resent and the
   * Shop must treat a repeat (same payload) as idempotent.
   */
  function send(conn, type, payload, { track = ACK_REQUIRED[type] === 'ack' } = {}) {
    const id = ids.ulid();
    const frame = serializeMessage(type, payload, { direction: 'cloud_to_shop', id });
    const deliver = (attempt) => {
      if (conn.ws.readyState !== conn.ws.OPEN) return;
      conn.ws.send(frame);
      if (!track) return;
      const timer = setTimeout(() => {
        if (!conn.pending.has(id)) return;
        if (attempt >= maxSendAttempts) {
          conn.pending.delete(id);
          logger.warn('bridge.ack_timeout', { deviceId: conn.deviceId, type, id });
          return;
        }
        deliver(attempt + 1);
      }, ackTimeoutMs);
      timer.unref?.();
      conn.pending.set(id, { timer, type });
    };
    deliver(1);
    return id;
  }

  function closeConn(conn, code, reason) {
    clearTimeout(conn.heartbeatTimer);
    if (live.get(conn.deviceId) === conn) live.delete(conn.deviceId);
    try {
      conn.ws.close(code, reason);
    } catch {
      /* already closing */
    }
    // Do not wait for the peer's close frame: revoke must take effect now.
    const t = setTimeout(() => conn.ws.terminate(), 1000);
    t.unref?.();
  }

  return {
    path: BRIDGE_PATH,
    handleUpgrade,
    /** online = a live, authenticated connection that said hello */
    isOnline(deviceId) {
      const c = live.get(deviceId);
      return Boolean(c && c.helloDone);
    },
    onlineDeviceIds() {
      return [...live.values()].filter((c) => c.helloDone).map((c) => c.deviceId);
    },
    /** Close a device's connection now (revoke). */
    disconnect(deviceId, code = CLOSE.REVOKED, reason = 'revoked') {
      const c = live.get(deviceId);
      if (c) closeConn(c, code, reason);
      if (code === CLOSE.REVOKED) dedupe.forget(deviceId);
      return Boolean(c);
    },
    disconnectAll(code = CLOSE.BRIDGE_DISABLED, reason = 'bridge disabled') {
      for (const c of [...live.values()]) closeConn(c, code, reason);
    },
    /** Rotate a device's token and push `token.rotate` on its live connection; the old token works 5 more minutes. */
    async rotateToken(deviceId, actor = 'owner') {
      const newToken = await devices.rotateToken(deviceId, actor);
      if (!newToken) return { rotated: false, delivered: false };
      const c = live.get(deviceId);
      const delivered = Boolean(c && c.helloDone);
      if (delivered) send(c, 'token.rotate', { newToken });
      return { rotated: true, delivered };
    },
    close() {
      this.disconnectAll(1001, 'hub shutting down');
      wss.close();
    },
  };
}

module.exports = { createBridgeServer, BRIDGE_PATH, CLOSE, SNAPSHOT_INTERVAL_SEC, createDedupe };
