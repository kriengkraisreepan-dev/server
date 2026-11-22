'use strict';

// Append-only audit log. S-5.3/S-5.4: callers never pass tokens or phone numbers in `detail`;
// `redact` drops any key that looks like a secret as a second line of defence.
const SECRET_KEY = /token|secret|password|hash|phone|authorization|cookie/i;

function redact(detail) {
  const out = {};
  for (const [k, v] of Object.entries(detail || {})) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function createAudit({ db, clock }) {
  return {
    /** @param {{ actor: string, action: string, target?: string, detail?: object }} entry */
    async record({ actor, action, target = null, detail = {} }, q = db) {
      await q.query(
        'INSERT INTO audit_log (at, actor, action, target, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [new Date(clock.now()), actor, action, target, JSON.stringify(redact(detail))],
      );
    },
    async recent(limit = 50) {
      const { rows } = await db.query(
        'SELECT id, at, actor, action, target, detail FROM audit_log ORDER BY id DESC LIMIT $1',
        [Math.min(Math.max(1, limit | 0), 500)],
      );
      return rows.map((r) => ({ ...r, id: Number(r.id), at: new Date(r.at).toISOString() }));
    },
  };
}

module.exports = { createAudit, redact };
