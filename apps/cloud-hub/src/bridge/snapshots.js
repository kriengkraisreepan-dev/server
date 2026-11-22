'use strict';

// Snapshot cache: latest validated snapshot per device + staleness (BRIDGE_PROTOCOL §6).
const STALE_AFTER_MS = 90 * 1000;

/**
 * stale = now - generatedAt > 90s, or the device is offline (§6 "Staleness ฝั่ง Cloud").
 * Agent (A4) and Publisher (A7) must check this every time (S-3.5, S-4.3).
 */
function isStale({ generatedAt, online, now }) {
  if (!online) return true;
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return true;
  return now - t > STALE_AFTER_MS;
}

function createSnapshots({ db, clock, isOnline }) {
  return {
    /**
     * Store a snapshot that already passed bridge-protocol's strict schema.
     * Out-of-order (seq not newer) snapshots are dropped so an old frame never overwrites a new one.
     * @returns {Promise<boolean>} true if stored
     */
    async store(deviceId, snapshot) {
      const { rows } = await db.query(
        `INSERT INTO snapshots_latest (device_id, seq, generated_at, received_at, snapshot)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (device_id) DO UPDATE
           SET seq = EXCLUDED.seq, generated_at = EXCLUDED.generated_at,
               received_at = EXCLUDED.received_at, snapshot = EXCLUDED.snapshot
           WHERE snapshots_latest.seq < EXCLUDED.seq
         RETURNING device_id`,
        [deviceId, snapshot.seq, new Date(snapshot.generatedAt), new Date(clock.now()), JSON.stringify(snapshot)],
      );
      return rows.length === 1;
    },

    /** Latest snapshot for a device with `stale` and `asOf`, or null if none was received. */
    async latest(deviceId) {
      const { rows } = await db.query(
        'SELECT seq, generated_at, received_at, snapshot FROM snapshots_latest WHERE device_id = $1',
        [deviceId],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      const generatedAt = new Date(r.generated_at).toISOString();
      const online = isOnline(deviceId);
      return {
        seq: Number(r.seq),
        asOf: generatedAt,
        receivedAt: new Date(r.received_at).toISOString(),
        online,
        stale: isStale({ generatedAt, online, now: clock.now() }),
        snapshot: r.snapshot,
      };
    },
  };
}

module.exports = { createSnapshots, isStale, STALE_AFTER_MS };
