'use strict';

// S-1.5 kill switches. Three exist from day one, even before A4 (AI chat) and A7 (publishing)
// have anything to switch off, so later tasks only read them.
const KILL_SWITCHES = Object.freeze(['ai_chat', 'publishing', 'bridge']);

function createKillSwitches({ db, audit, clock, onChange = () => {} }) {
  return {
    names: KILL_SWITCHES,
    async all() {
      const { rows } = await db.query('SELECT name, enabled, updated_at FROM kill_switches');
      const out = {};
      for (const name of KILL_SWITCHES) {
        const row = rows.find((r) => r.name === name);
        // A missing row fails closed: the feature is treated as switched off.
        out[name] = row ? { enabled: row.enabled, updatedAt: new Date(row.updated_at).toISOString() } : { enabled: false, updatedAt: null };
      }
      return out;
    },
    async isEnabled(name) {
      if (!KILL_SWITCHES.includes(name)) throw new TypeError(`unknown kill switch: ${name}`);
      const { rows } = await db.query('SELECT enabled FROM kill_switches WHERE name = $1', [name]);
      return rows.length === 1 && rows[0].enabled === true;
    },
    async set(name, enabled, actor = 'owner') {
      if (!KILL_SWITCHES.includes(name)) throw new TypeError(`unknown kill switch: ${name}`);
      if (typeof enabled !== 'boolean') throw new TypeError('enabled must be boolean');
      await db.tx(async (t) => {
        await t.query(
          `INSERT INTO kill_switches (name, enabled, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (name) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
          [name, enabled, new Date(clock.now())],
        );
        await audit.record({ actor, action: 'kill_switch.set', target: name, detail: { enabled } }, t);
      });
      await onChange(name, enabled);
    },
  };
}

module.exports = { createKillSwitches, KILL_SWITCHES };
