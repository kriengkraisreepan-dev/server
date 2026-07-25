const fs = require("fs");
const path = require("path");
const { openDatabase, closeDatabase } = require("./database");
const { applyMigrations } = require("./migration-runner");
const { validateJsonStore } = require("./validation/json-store-validator");
const { importStore } = require("./repositories/legacy-import-repository");

function readStore(sourcePath) { return JSON.parse(fs.readFileSync(sourcePath, "utf8")); }
function verifyDatabase(db, expected) {
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  const count = table => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  const actual = { tables: count("snooker_tables"), members: count("members"), products: count("products"), sales: count("sales"), payments: count("payments") };
  const countMatches = actual.tables === expected.tables && actual.members === expected.members && actual.products === expected.products && actual.sales === expected.bills && actual.payments === expected.payments;
  if (integrity.integrity_check !== "ok") throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
  if (foreignKeys.length) throw new Error("SQLite foreign key check failed");
  if (!countMatches) throw new Error(`Imported row counts do not match source: ${JSON.stringify(actual)}`);
  return actual;
}

function importJsonStore({ sourcePath, targetPath, dryRun = false }) {
  const source = path.resolve(sourcePath), target = path.resolve(targetPath);
  if (!fs.existsSync(source)) throw new Error(`Source JSON not found: ${source}`);
  if (source === target) throw new Error("Source and target paths must be different");
  const store = readStore(source), validation = validateJsonStore(store);
  if (!validation.valid) { const details = validation.errors.map(error => `${error.path}: ${error.code}`).join("; "); throw new Error(`JSON validation failed: ${details}`); }
  const report = { source, target, dryRun, validation, migrations: [], imported: {}, verified: null };
  if (dryRun) return report;
  if (fs.existsSync(target)) throw new Error(`Refusing to overwrite existing SQLite database: ${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.importing-${process.pid}-${Date.now()}`;
  let db;
  try {
    db = openDatabase(temporary);
    report.migrations = applyMigrations(db, path.join(__dirname, "migrations"));
    db.exec("BEGIN IMMEDIATE");
    report.imported = importStore(db, store);
    db.exec("COMMIT");
    report.verified = verifyDatabase(db, validation.counts);
    closeDatabase(db); db = null;
    fs.renameSync(temporary, target);
    return report;
  } catch (error) {
    try { if (db) { try { db.exec("ROLLBACK"); } catch { /* no open transaction */ } closeDatabase(db); } } finally { [temporary, `${temporary}-journal`, `${temporary}-wal`, `${temporary}-shm`].forEach(file => { if (fs.existsSync(file)) fs.rmSync(file, { force: true }); }); }
    throw error;
  }
}
module.exports = { importJsonStore, readStore, verifyDatabase };
