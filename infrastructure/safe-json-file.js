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

function atomicWriteJson(file, value, { keepBackup = true } = {}) {
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
      fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (keepBackup && fs.existsSync(target)) {
      fs.copyFileSync(target, backup);
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
