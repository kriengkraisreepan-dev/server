const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const writeState = new Map();

function parseJsonFile(file, validate = () => true) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!validate(value)) {
    const error = new Error(`JSON schema validation failed: ${path.basename(file)}`);
    error.code = "JSON_SCHEMA_INVALID";
    throw error;
  }
  return value;
}

function flushDirectory(directory) {
  try {
    const descriptor = fs.openSync(directory, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch {}
}

function restrictFileToBackendAccount(file) {
  try { fs.chmodSync(file, 0o600); } catch {}
}

// `pretty` defaults to true because backups and the small config files are read by humans during
// support. The hot store file passes pretty:false: it is rewritten on every table open, relay
// toggle and POS line, and indentation is ~30% of its bytes — pure per-click I/O for nobody's
// benefit, since the Backups screen still writes readable archives.
function atomicWriteJson(file, value, { keepBackup = true, pretty = true } = {}) {
  const target = path.resolve(file);
  if (writeState.get(target)) {
    const error = new Error(`Concurrent JSON write rejected: ${path.basename(target)}`);
    error.code = "JSON_WRITE_BUSY";
    throw error;
  }
  writeState.set(target, true);
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const backup = `${target}.bak`;
  try {
    fs.mkdirSync(directory, { recursive: true });
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value), "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    // Rotating the previous version into place with a rename rather than copyFileSync: a copy
    // rewrites every byte of the dataset a second time on every single save, while a rename is a
    // metadata-only operation whose cost never grows with the data. It is also strictly safer —
    // rename is atomic, so .bak can never be left half-written. The window it opens instead is a
    // crash between the two renames, which leaves the good copy at .bak with no primary;
    // readJsonWithRecovery() below handles exactly that case.
    if (keepBackup && fs.existsSync(target)) {
      try { fs.rmSync(backup, { force: true }); } catch {}
      fs.renameSync(target, backup);
      restrictFileToBackendAccount(backup);
    }
    fs.renameSync(temporary, target);
    restrictFileToBackendAccount(target);
    flushDirectory(directory);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    writeState.delete(target);
  }
}

function readJsonWithRecovery(file, { validate = () => true, create } = {}) {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) {
    // A crash in the rename window inside atomicWriteJson() parks the last good copy at .bak with
    // no primary. Promote it back before anything else, so a missing primary never gets treated
    // as a first run and seeded over a real shop's data.
    const orphanedBackup = `${target}.bak`;
    if (fs.existsSync(orphanedBackup)) {
      try {
        const value = parseJsonFile(orphanedBackup, validate);
        atomicWriteJson(target, value, { keepBackup: false });
        return { value, source: "backup", recovered: true };
      } catch {}
    }
    if (typeof create !== "function") {
      const error = new Error(`JSON file not found: ${path.basename(target)}`);
      error.code = "JSON_FILE_MISSING";
      throw error;
    }
    const value = create();
    atomicWriteJson(target, value, { keepBackup: false });
    return { value, source: "created", recovered: false };
  }
  try {
    return { value: parseJsonFile(target, validate), source: "primary", recovered: false };
  } catch (primaryError) {
    const backup = `${target}.bak`;
    try {
      const value = parseJsonFile(backup, validate);
      const corruptCopy = `${target}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      fs.copyFileSync(target, corruptCopy);
      atomicWriteJson(target, value, { keepBackup: false });
      return { value, source: "backup", recovered: true, corruptCopy };
    } catch (backupError) {
      const error = new Error(`Unable to recover ${path.basename(target)}: primary and backup are invalid`);
      error.code = "JSON_RECOVERY_FAILED";
      error.primaryError = primaryError;
      error.backupError = backupError;
      throw error;
    }
  }
}

function activeJsonWrites() { return [...writeState.keys()]; }

module.exports = { atomicWriteJson, readJsonWithRecovery, activeJsonWrites };
