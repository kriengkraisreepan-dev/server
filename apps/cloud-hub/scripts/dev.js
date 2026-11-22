'use strict';

// `npm run dev` — one command, no Docker: PGlite database in ./.dev-data, dev owner password.
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createHub } = require('../src/app');
const { hashPassword } = require('../src/admin/auth');

(async () => {
  process.env.NODE_ENV = 'development';
  const config = loadConfig();
  if (!config.databaseUrl && !config.pgliteDir) config.pgliteDir = path.join(__dirname, '..', '.dev-data');
  let password = null;
  if (!config.adminPasswordHash) {
    password = process.env.DEV_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    config.adminPasswordHash = hashPassword(password);
  }
  const hub = await createHub(config);
  const addr = await hub.listen(config.port, process.env.HOST || '127.0.0.1');
  console.log(`\n88Snooker Cloud hub (dev) — db: ${hub.db.kind}${config.pgliteDir ? ` (${config.pgliteDir})` : ''}`);
  console.log(`  Admin web : http://localhost:${addr.port}/admin/`);
  if (password) console.log(`  Password  : ${password}   (dev only; set ADMIN_PASSWORD_HASH to choose one)`);
  console.log(`  Bridge    : ${config.publicWsUrl}\n`);
  process.on('SIGINT', () => hub.close().then(() => process.exit(0)));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
