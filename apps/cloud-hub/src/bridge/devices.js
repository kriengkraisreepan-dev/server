'use strict';

// Device registry: pairing codes, device tokens (hash only, S-5.2), rotate, revoke.
// BRIDGE_PROTOCOL §2.
const { z } = require('zod');
const ids = require('../ids');

const PAIRING_TTL_MS = 10 * 60 * 1000;
const TOKEN_ROTATE_GRACE_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_PAIR_FAILURES = 5;

const PairRequest = z.strictObject({
  pairingCode: z.string().regex(new RegExp(`^[${ids.PAIRING_ALPHABET}]{${ids.PAIRING_CODE_LENGTH}}$`)),
  deviceName: z.string().trim().min(1).max(60),
  appVersion: z.string().min(1).max(32),
});

class PairingError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function createDevices({ db, audit, clock, hubUrl }) {
  let consecutiveFailures = 0;

  async function createPairingCode(actor = 'owner') {
    const now = clock.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = ids.pairingCode();
      const { rows } = await db.query(
        `INSERT INTO pairing_codes (code, created_at, expires_at) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING RETURNING code`,
        [code, new Date(now), new Date(now + PAIRING_TTL_MS)],
      );
      if (rows.length === 1) {
        // The code itself is short-lived and single-use; keep it out of the audit log anyway.
        await audit.record({ actor, action: 'pairing_code.created', detail: { expiresAt: new Date(now + PAIRING_TTL_MS).toISOString() } });
        return { code, expiresAt: new Date(now + PAIRING_TTL_MS).toISOString() };
      }
    }
    throw new Error('could not allocate a unique pairing code');
  }

  /** Cancel every code that could still be used (after too many wrong guesses in a row). */
  async function cancelOutstandingCodes(reason) {
    const now = new Date(clock.now());
    const { rows } = await db.query(
      `UPDATE pairing_codes SET cancelled_at = $1
       WHERE used_at IS NULL AND cancelled_at IS NULL AND expires_at > $1 RETURNING code`,
      [now],
    );
    await audit.record({ actor: 'system', action: 'pairing_code.cancelled_all', detail: { reason, count: rows.length } });
    return rows.length;
  }

  /**
   * POST /bridge/v1/pair body. Throws PairingError for anything that must not pair.
   * The response never says *why* a code failed (wrong / used / expired) to avoid an oracle.
   */
  async function pair(body, { ip }) {
    const parsed = PairRequest.safeParse(body);
    if (!parsed.success) {
      await recordFailure(ip);
      throw new PairingError('invalid_request', 400);
    }
    const { pairingCode, deviceName, appVersion } = parsed.data;
    const now = new Date(clock.now());

    const result = await db.tx(async (t) => {
      // Single use: only one transaction can flip used_at from NULL (S-5.2, §2 step 1).
      const used = await t.query(
        `UPDATE pairing_codes SET used_at = $2
         WHERE code = $1 AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > $2
         RETURNING code`,
        [pairingCode, now],
      );
      if (used.rows.length !== 1) return null;

      const deviceId = ids.deviceId();
      const deviceToken = ids.deviceToken();
      await t.query(
        `INSERT INTO devices (device_id, device_name, app_version, token_hash, paired_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [deviceId, deviceName, appVersion, ids.sha256Hex(deviceToken), now],
      );
      await t.query('UPDATE pairing_codes SET used_by_device = $1 WHERE code = $2', [deviceId, pairingCode]);
      await audit.record({ actor: `device:${deviceId}`, action: 'device.paired', target: deviceId, detail: { deviceName, appVersion, ip } }, t);
      return { deviceId, deviceToken };
    });

    if (!result) {
      await recordFailure(ip);
      throw new PairingError('invalid_code', 400);
    }
    consecutiveFailures = 0;
    return { deviceId: result.deviceId, deviceToken: result.deviceToken, hubUrl };
  }

  async function recordFailure(ip) {
    consecutiveFailures += 1;
    await audit.record({ actor: 'system', action: 'pairing.failed', detail: { ip, consecutive: consecutiveFailures } });
    // BRIDGE_PROTOCOL §2.7: 5 wrong in a row → the code is cancelled. A wrong guess does not
    // say which code was targeted, so every outstanding code is cancelled.
    if (consecutiveFailures >= MAX_CONSECUTIVE_PAIR_FAILURES) {
      consecutiveFailures = 0;
      await cancelOutstandingCodes('too_many_failures');
    }
  }

  /** Resolve a bearer token to an active device, or null. Accepts the previous token during the rotate grace. */
  async function authenticate(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const hash = ids.sha256Hex(token);
    const { rows } = await db.query(
      `SELECT device_id, device_name FROM devices
       WHERE revoked_at IS NULL
         AND (token_hash = $1 OR (prev_token_hash = $1 AND prev_token_expires_at > $2))`,
      [hash, new Date(clock.now())],
    );
    return rows.length === 1 ? { deviceId: rows[0].device_id, deviceName: rows[0].device_name } : null;
  }

  /** Issue a new token; the current one stays valid for 5 minutes (BRIDGE_PROTOCOL §5 token.rotate). */
  async function rotateToken(deviceId, actor = 'owner') {
    const newToken = ids.deviceToken();
    const now = clock.now();
    const { rows } = await db.query(
      `UPDATE devices SET prev_token_hash = token_hash, prev_token_expires_at = $2, token_hash = $3
       WHERE device_id = $1 AND revoked_at IS NULL RETURNING device_id`,
      [deviceId, new Date(now + TOKEN_ROTATE_GRACE_MS), ids.sha256Hex(newToken)],
    );
    if (rows.length !== 1) return null;
    await audit.record({ actor, action: 'device.token_rotated', target: deviceId });
    return newToken;
  }

  /** Revoke: tokens wiped so they can never match again. The caller closes live sockets. */
  async function revoke(deviceId, actor = 'owner') {
    const { rows } = await db.query(
      `UPDATE devices SET revoked_at = $2, token_hash = NULL, prev_token_hash = NULL, prev_token_expires_at = NULL
       WHERE device_id = $1 AND revoked_at IS NULL RETURNING device_id`,
      [deviceId, new Date(clock.now())],
    );
    if (rows.length !== 1) return false;
    await audit.record({ actor, action: 'device.revoked', target: deviceId });
    return true;
  }

  async function touch(deviceId) {
    await db.query('UPDATE devices SET last_seen_at = $2 WHERE device_id = $1', [deviceId, new Date(clock.now())]);
  }

  async function list() {
    const { rows } = await db.query(
      `SELECT device_id, device_name, app_version, paired_at, last_seen_at, revoked_at
       FROM devices ORDER BY paired_at DESC`,
    );
    return rows.map((r) => ({
      deviceId: r.device_id,
      deviceName: r.device_name,
      appVersion: r.app_version,
      pairedAt: iso(r.paired_at),
      lastSeenAt: iso(r.last_seen_at),
      revokedAt: iso(r.revoked_at),
    }));
  }

  return { createPairingCode, pair, authenticate, rotateToken, revoke, touch, list, cancelOutstandingCodes };
}

function iso(v) {
  return v ? new Date(v).toISOString() : null;
}

module.exports = { createDevices, PairingError, PairRequest, PAIRING_TTL_MS, TOKEN_ROTATE_GRACE_MS, MAX_CONSECUTIVE_PAIR_FAILURES };
