const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(filename) { return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex"); }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function createFileBackup(sourcePath, backupDirectory, kind) {
  const source = path.resolve(sourcePath); if (!fs.existsSync(source)) throw new Error(`Backup source not found: ${source}`);
  fs.mkdirSync(backupDirectory, { recursive: true });
  const extension = path.extname(source) || ".data";
  const file = `${kind}-${timestamp()}${extension}`, target = path.join(backupDirectory, file);
  fs.copyFileSync(source, target);
  const manifest = { formatVersion: 1, kind, file, sourceName: path.basename(source), createdAt: new Date().toISOString(), bytes: fs.statSync(target).size, sha256: sha256(target) };
  fs.writeFileSync(`${target}.manifest.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}
function verifyFileBackup(backupPath) {
  const manifestPath = `${backupPath}.manifest.json`; if (!fs.existsSync(manifestPath)) throw new Error("Backup manifest not found");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return { valid: fs.existsSync(backupPath) && manifest.sha256 === sha256(backupPath), manifest };
}
module.exports = { createFileBackup, verifyFileBackup };
