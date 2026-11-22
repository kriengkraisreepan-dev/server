'use strict';

// One small interface over Postgres: `query(text, params)`, `tx(fn)`, `close()`.
// Production/staging and docker compose use real Postgres via `pg`.
// Tests and `npm run dev` without DATABASE_URL use PGlite (Postgres compiled to WASM, in-process).
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function wrapPg(pool) {
  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    exec: (sql) => pool.query(sql),
    close: () => pool.end(),
  };
}

function wrapPglite(pg) {
  return {
    kind: 'pglite',
    query: (text, params) => pg.query(text, params),
    tx: (fn) => pg.transaction((t) => fn({ query: (q, p) => t.query(q, p) })),
    exec: (sql) => pg.exec(sql),
    close: () => pg.close(),
  };
}

/**
 * @param {{ databaseUrl?: string, pgliteDir?: string }} options
 *   databaseUrl → node-postgres pool. Otherwise PGlite (in memory, or persisted in pgliteDir).
 */
async function openDatabase({ databaseUrl, pgliteDir } = {}) {
  if (databaseUrl) {
    const { Pool } = require('pg');
    return wrapPg(new Pool({ connectionString: databaseUrl, max: 10 }));
  }
  // devDependency: only tests and local dev reach this branch.
  const { PGlite } = require('@electric-sql/pglite');
  const pg = pgliteDir ? new PGlite(pgliteDir) : new PGlite();
  await pg.waitReady;
  return wrapPglite(pg);
}

/** Apply every migrations/*.sql not yet recorded in schema_migrations, in name order. */
async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (t) => {
      for (const stmt of splitStatements(sql)) await t.query(stmt);
      await t.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

/** Split a migration file on `;` at line end. Migrations must not use `;` inside strings/functions. */
function splitStatements(sql) {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

module.exports = { openDatabase, migrate };
