'use strict';

// A2 acceptance / S-5.2: the Cloud stores only sha256(deviceToken).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startHub } = require('./helpers');

async function dumpAllTables(db) {
  const { rows: tables } = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()",
  );
  let all = '';
  for (const { table_name } of tables) {
    const { rows } = await db.query(`SELECT * FROM "${table_name}"`);
    all += JSON.stringify(rows);
  }
  return all;
}

test('device token is stored as sha256 only', async (t) => {
  const h = await startHub();
  t.after(() => h.close());

  const { deviceId, deviceToken } = await h.pairDevice();
  const { rows } = await h.db.query('SELECT token_hash FROM devices WHERE device_id = $1', [deviceId]);
  assert.equal(rows[0].token_hash, crypto.createHash('sha256').update(deviceToken).digest('hex'));

  // Rotate too, so both token columns are populated.
  const { client } = { client: await h.connect(deviceToken) };
  await client.hello(deviceId);
  await h.hub.bridge.rotateToken(deviceId);
  const rotate = await client.next((m) => m.type === 'token.rotate');

  const dump = await dumpAllTables(h.db);
  for (const plain of [deviceToken, rotate.payload.newToken]) {
    assert.ok(!dump.includes(plain), 'plaintext token must not appear in any table');
  }
  // Nor in logs.
  assert.ok(!JSON.stringify(h.logger.events).includes(deviceToken));
});
