'use strict';

// Run the test suite against a real Postgres. Needs TEST_DATABASE_URL, e.g. with the compose db:
//   docker compose up -d db
//   TEST_DATABASE_URL=postgres://hub:hub-dev-only@localhost:5432/cloud_hub npm run test:postgres
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL is required');
  process.exit(1);
}
const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
