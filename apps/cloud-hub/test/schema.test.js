'use strict';

// A2: initial Postgres schema (devices, snapshots_latest, audit_log + pairing_codes, kill_switches).
// A4: chat tables (conversations, chat_messages, processed_inbound, shop_info, faq).
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('../src/db');
const { testDatabase } = require('./helpers');

test('migrations create the A2 + A4 tables and are idempotent', async () => {
  const db = await testDatabase();
  try {
    assert.deepEqual(await migrate(db), ['001_init.sql', '002_chat.sql']);
    assert.deepEqual(await migrate(db), []);
    const { rows } = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY 1");
    assert.deepEqual(rows.map((r) => r.table_name), ['audit_log', 'chat_messages', 'conversations', 'devices', 'faq', 'kill_switches', 'pairing_codes', 'processed_inbound', 'schema_migrations', 'shop_info', 'snapshots_latest']);
    const cols = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'devices' AND table_schema = current_schema()");
    const names = cols.rows.map((r) => r.column_name);
    assert.ok(names.includes('token_hash'));
    assert.ok(!names.some((n) => n === 'token' || n === 'device_token'), 'no plaintext token column (S-5.2)');
    const conv = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'conversations' AND table_schema = current_schema()");
    assert.ok(!conv.rows.some((r) => /name|phone/.test(r.column_name)), 'conversations store no customer name/phone (S-2, S-6)');
    await assert.rejects(db.query("INSERT INTO kill_switches (name, enabled, updated_at) VALUES ('relay', true, now())"), 'only the 3 known switches');
  } finally {
    await db.close();
  }
});
