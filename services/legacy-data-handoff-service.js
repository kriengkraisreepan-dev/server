const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson } = require("../infrastructure/safe-json-file");

const REQUIRED = Object.freeze(["store.json", "reservations.json", "reservation-deposits.json", "hardware-devices.json"]);
const MIGRATION_ID = "program-data-separation-v1";
function sha256File(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function safeJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function hasCustomerFiles(directory) { return fs.existsSync(directory) && fs.readdirSync(directory).some(name => !name.startsWith(".")); }
function assertRegularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error("Legacy source contains an unsupported filesystem entry"), { code: "LEGACY_SOURCE_UNSAFE_ENTRY" });
}

class LegacyDataHandoffService {
  constructor({ sourceRoot, destinationRoot, applicationVersion = "1.0.0", now = () => new Date(), log = () => {} } = {}) {
    Object.assign(this, { sourceRoot: path.resolve(sourceRoot), destinationRoot: path.resolve(destinationRoot), applicationVersion, now, log });
    this.migrationRoot = path.join(this.destinationRoot, "migration");
    this.markerFile = path.join(this.migrationRoot, `${MIGRATION_ID}.json`);
    this.journalFile = path.join(this.migrationRoot, `${MIGRATION_ID}.journal.json`);
    this.lockFile = path.join(this.migrationRoot, `${MIGRATION_ID}.lock`);
  }

  inspectJson(root = this.sourceRoot) {
    const values = {};
    for (const name of REQUIRED) {
      const file = path.join(root, name);
      if (!fs.existsSync(file)) return { valid: false, reason: "REQUIRED_FILE_MISSING" };
      try { assertRegularFile(file); } catch (error) { return { valid: false, reason: error.code }; }
      const value = safeJson(file); if (value === null) return { valid: false, reason: "INVALID_JSON" };
      values[name] = value;
    }
    const store = values["store.json"];
    if (!store || typeof store !== "object" || !["tables", "members", "products", "bills", "payments"].every(key => Array.isArray(store[key]))) return { valid: false, reason: "STORE_SCHEMA_INVALID" };
    if (!Array.isArray(values["reservations.json"]) || !Array.isArray(values["reservation-deposits.json"]) || !Array.isArray(values["hardware-devices.json"])) return { valid: false, reason: "REPOSITORY_SCHEMA_INVALID" };
    return { valid: true };
  }

  detect() {
    const marker = safeJson(this.markerFile), journal = safeJson(this.journalFile);
    if (marker?.status === "COMPLETED" && marker.migrationId === MIGRATION_ID) return { status: "MIGRATION_ALREADY_COMPLETE", marker };
    if (journal && journal.status !== "COMPLETED") return { status: "MIGRATION_INCOMPLETE", stage: journal.stage };
    if (!fs.existsSync(this.sourceRoot) || !REQUIRED.some(name => fs.existsSync(path.join(this.sourceRoot, name)))) return { status: "NO_LEGACY_DATA" };
    const validation = this.inspectJson();
    if (!validation.valid) return { status: "LEGACY_DATA_INVALID", reason: validation.reason };
    if (hasCustomerFiles(path.join(this.destinationRoot, "database")) || hasCustomerFiles(path.join(this.destinationRoot, "backups"))) return { status: "LEGACY_DATA_AMBIGUOUS" };
    return { status: "LEGACY_DATA_AVAILABLE", manifest: this.manifest(this.sourceRoot) };
  }

  manifest(root) {
    const files = [];
    for (const name of REQUIRED) {
      const file = path.join(root, name); if (fs.existsSync(file)) { assertRegularFile(file); files.push({ relativePath: `database/${name}`, size: fs.statSync(file).size, sha256: sha256File(file) }); }
      const backup = `${file}.bak`; if (fs.existsSync(backup)) { assertRegularFile(backup); files.push({ relativePath: `database/${name}.bak`, size: fs.statSync(backup).size, sha256: sha256File(backup) }); }
    }
    const backupRoot = path.join(root, "backups");
    if (fs.existsSync(backupRoot)) {
      if (fs.lstatSync(backupRoot).isSymbolicLink()) throw Object.assign(new Error("Legacy backup directory cannot be a symlink"), { code: "LEGACY_SOURCE_UNSAFE_ENTRY" });
      for (const name of fs.readdirSync(backupRoot).filter(name => /^backup-.*\.json$/.test(name)).sort()) { const file = path.join(backupRoot, name); assertRegularFile(file); files.push({ relativePath: `backups/${name}`, size: fs.statSync(file).size, sha256: sha256File(file) }); }
    }
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return { schemaVersion: 1, fileCount: files.length, files, sha256: stableHash(files) };
  }

  acquireLock() { fs.mkdirSync(this.migrationRoot, { recursive: true, mode: 0o700 }); const handle = fs.openSync(this.lockFile, "wx", 0o600); fs.writeFileSync(handle, JSON.stringify({ migrationId: MIGRATION_ID, pid: process.pid, startedAt: this.now().toISOString() })); return handle; }
  releaseLock(handle) { try { fs.closeSync(handle); } catch {} try { fs.unlinkSync(this.lockFile); } catch {} }

  copyManifest(sourceManifest, staging) {
    for (const entry of sourceManifest.files) {
      const source = entry.relativePath.startsWith("database/") ? path.join(this.sourceRoot, entry.relativePath.slice(9)) : path.join(this.sourceRoot, entry.relativePath);
      const target = path.join(staging, entry.relativePath); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.copyFileSync(source, target); fs.chmodSync(target, 0o600);
    }
  }

  writeJournal(value) { atomicWriteJson(this.journalFile, { schemaVersion: 1, migrationId: MIGRATION_ID, status: "IN_PROGRESS", ...value }); }

  directoryMatchesManifest(directory, root, manifest) {
    const expected = manifest.files.filter(entry => entry.relativePath.startsWith(`${directory}/`));
    if (!expected.length) return !hasCustomerFiles(path.join(root, directory));
    return expected.every(entry => {
      const file = path.join(root, entry.relativePath);
      return fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size === entry.size && sha256File(file) === entry.sha256;
    });
  }

  activateDirectory(directory, staging, sourceManifest) {
    const source = path.join(staging, directory), target = path.join(this.destinationRoot, directory);
    if (this.directoryMatchesManifest(directory, this.destinationRoot, sourceManifest)) return;
    if (!fs.existsSync(source)) throw Object.assign(new Error(`Migration staging is missing ${directory}`), { code: "MIGRATION_RECOVERY_INCOMPLETE" });
    if (hasCustomerFiles(target)) throw Object.assign(new Error("Destination is not empty"), { code: "LEGACY_DATA_AMBIGUOUS" });
    if (fs.existsSync(target)) fs.rmdirSync(target);
    fs.renameSync(source, target);
  }

  migrate() {
    const detected = this.detect();
    if (detected.status === "MIGRATION_ALREADY_COMPLETE") return detected;
    if (detected.status !== "LEGACY_DATA_AVAILABLE" && detected.status !== "MIGRATION_INCOMPLETE") throw Object.assign(new Error(`Legacy migration blocked: ${detected.status}`), { code: detected.status });
    let lock;
    try {
      lock = this.acquireLock();
      const previous = safeJson(this.journalFile);
      const migrationRunId = previous?.migrationRunId || crypto.randomUUID();
      const staging = path.join(this.migrationRoot, `.staging-${migrationRunId}`);
      const recovery = path.join(this.migrationRoot, `.recovery-${migrationRunId}`);
      let sourceManifest = previous?.sourceManifestSha256 && safeJson(path.join(this.migrationRoot, `${migrationRunId}-source-manifest.json`));
      if (!sourceManifest) {
        sourceManifest = this.manifest(this.sourceRoot);
        this.writeJournal({ migrationRunId, stage: "COPYING", startedAt: this.now().toISOString(), sourceManifestSha256: sourceManifest.sha256 });
        atomicWriteJson(path.join(this.migrationRoot, `${migrationRunId}-source-manifest.json`), sourceManifest);
        fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
        this.copyManifest(sourceManifest, staging);
      } else if (!fs.existsSync(staging) && fs.existsSync(recovery)) {
        fs.cpSync(recovery, staging, { recursive: true, errorOnExist: true });
      }
      if (fs.existsSync(recovery)) for (const directory of ["database", "backups"]) {
        const stagedDirectory = path.join(staging, directory);
        const recoveryDirectory = path.join(recovery, directory);
        if (!fs.existsSync(stagedDirectory) && fs.existsSync(recoveryDirectory)) fs.cpSync(recoveryDirectory, stagedDirectory, { recursive: true, errorOnExist: true });
      }
      const stagedManifest = this.manifestStaging(staging);
      if (sourceManifest.sha256 !== stagedManifest.sha256) throw Object.assign(new Error("Migration hash mismatch"), { code: "MIGRATION_HASH_MISMATCH" });
      const stagedValidation = this.inspectJson(path.join(staging, "database"));
      if (!stagedValidation.valid) throw Object.assign(new Error("Staged repository validation failed"), { code: "MIGRATION_STAGED_INVALID", reason: stagedValidation.reason });
      if (!fs.existsSync(recovery)) fs.cpSync(staging, recovery, { recursive: true, errorOnExist: true });
      if (this.manifestStaging(recovery).sha256 !== sourceManifest.sha256) throw Object.assign(new Error("Recovery copy hash mismatch"), { code: "MIGRATION_RECOVERY_HASH_MISMATCH" });
      this.writeJournal({ migrationRunId, stage: "VERIFIED", sourceManifestSha256: sourceManifest.sha256 });
      for (const directory of ["database", "backups"]) {
        this.writeJournal({ migrationRunId, stage: `ACTIVATING_${directory.toUpperCase()}`, sourceManifestSha256: sourceManifest.sha256 });
        this.activateDirectory(directory, staging, sourceManifest);
      }
      const destinationManifest = this.manifestDestination();
      if (destinationManifest.sha256 !== sourceManifest.sha256) throw Object.assign(new Error("Activated data hash mismatch"), { code: "MIGRATION_ACTIVATION_MISMATCH" });
      const marker = { schemaVersion: 1, migrationId: MIGRATION_ID, sourceLayout: "legacy-application-data", completedAt: this.now().toISOString(), sourceManifestSha256: sourceManifest.sha256, destinationManifestSha256: destinationManifest.sha256, applicationVersion: this.applicationVersion, status: "COMPLETED" };
      atomicWriteJson(this.markerFile, marker); atomicWriteJson(this.journalFile, { ...marker, stage: "COMMITTED" });
      fs.rmSync(staging, { recursive: true, force: true });
      this.log("INFO", "LEGACY_DATA_HANDOFF_COMPLETED", { migrationId: MIGRATION_ID, fileCount: sourceManifest.fileCount, manifestSha256: sourceManifest.sha256 });
      return { status: "MIGRATION_ALREADY_COMPLETE", marker };
    } catch (error) {
      this.log("ERROR", "LEGACY_DATA_HANDOFF_FAILED", { migrationId: MIGRATION_ID, errorCode: error.code || "MIGRATION_FAILED" }); throw error;
    } finally { if (lock !== undefined) this.releaseLock(lock); }
  }

  manifestStaging(staging) { const files = []; for (const directory of ["database", "backups"]) { const root = path.join(staging, directory); if (!fs.existsSync(root)) continue; for (const name of fs.readdirSync(root).sort()) { const file = path.join(root, name); if (fs.statSync(file).isFile()) files.push({ relativePath: `${directory}/${name}`, size: fs.statSync(file).size, sha256: sha256File(file) }); } } files.sort((a,b)=>a.relativePath.localeCompare(b.relativePath)); return { schemaVersion: 1, fileCount: files.length, files, sha256: stableHash(files) }; }
  manifestDestination() { return this.manifestStaging(this.destinationRoot); }
}

module.exports = { LegacyDataHandoffService, MIGRATION_ID, REQUIRED };
