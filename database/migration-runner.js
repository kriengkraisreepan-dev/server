const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
function checksum(sql) { return crypto.createHash("sha256").update(sql).digest("hex"); }
function readMigrations(migrationsDir) { return fs.readdirSync(migrationsDir).filter(file => /^\d{3}_.+\.sql$/.test(file)).sort().map(file => { const match = file.match(/^(\d{3})_(.+)\.sql$/); const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8"); return { version: Number(match[1]), name: match[2], file, sql, checksum: checksum(sql) }; }); }
function ensureMigrationHistory(db) { db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);"); }
function applyMigrations(db, migrationsDir) {
  ensureMigrationHistory(db);
  const applied = new Map(db.prepare("SELECT version, checksum FROM schema_migrations").all().map(row => [row.version, row.checksum]));
  const pending = [];
  for (const migration of readMigrations(migrationsDir)) { if (applied.has(migration.version)) { if (applied.get(migration.version) !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.file}`); } else pending.push(migration); }
  for (const migration of pending) { try { db.exec("BEGIN IMMEDIATE"); db.exec(migration.sql); db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(migration.version, migration.name, migration.checksum, new Date().toISOString()); db.exec("COMMIT"); } catch (error) { try { db.exec("ROLLBACK"); } catch { /* no open transaction */ } throw new Error(`Migration ${migration.file} failed: ${error.message}`); } }
  return pending.map(migration => migration.file);
}
module.exports = { applyMigrations, readMigrations, checksum };
