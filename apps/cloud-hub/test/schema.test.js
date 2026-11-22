'use strict';

// A2: initial Postgres schema (devices, snapshots_latest, audit_log + pairing_codes, kill_switches).
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../src/db');
const { testDatabase } = require('./helpers');

test('migrations create the A2 tables and are idempotent', async () => {
  const db = await testDatabase();
  try {
    assert.deepEqual(await migrate(db), ['001_init.sql']);
    assert.deepEqual(await migrate(db), []);
    const { rows } = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY 1");
    assert.deepEqual(rows.map((r) => r.table_name), ['audit_log', 'devices', 'kill_switches', 'pairing_codes', 'schema_migrations', 'snapshots_latest']);
    const cols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'devices' AND table_schema = current_schema()");
    const names = cols.rows.map((r) => r.column_name);
    assert.ok(names.includes('token_hash'));
    assert.ok(!names.some((n) => n === 'token' || n === 'device_token'), 'no plaintext token column (S-5.2)');
    await assert.rejects(db.query("INSERT INTO kill_switches (name, enabled, updated_at) VALUES ('relay', true, now())"), 'only the 3 known switches');
  } finally {
    await db.close();
  }
});
