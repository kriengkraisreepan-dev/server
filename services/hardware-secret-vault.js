const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson, readJsonWithRecovery } = require("../infrastructure/safe-json-file");

function validVault(value) { return value && value.schemaVersion === 1 && value.protection === "DPAPI_CURRENT_USER" && value.secrets && typeof value.secrets === "object" && !Array.isArray(value.secrets); }
class HardwareSecretVault {
  constructor({ file, protector, randomUUID = crypto.randomUUID } = {}) {
    if (!file || !protector) throw new TypeError("file and protector are required");
    Object.assign(this, { file: path.resolve(file), protector, randomUUID });
    this.value = readJsonWithRecovery(this.file, { validate: validVault, create: () => ({ schemaVersion: 1, protection: "DPAPI_CURRENT_USER", secrets: {} }) }).value;
  }
  put(secret) {
    if (typeof secret !== "string" || !secret.length) throw Object.assign(new Error("Device Key is invalid"), { code: "VAULT_SECRET_INVALID" });
    const id = `hws-${this.randomUUID()}`;
    const encrypted = this.protector.protect(secret);
    const next = structuredClone(this.value); next.secrets[id] = { ciphertext: encrypted, createdAt: new Date().toISOString() };
    atomicWriteJson(this.file, next); this.value = next;
    if (this.get(id) !== secret) { this.delete(id); throw Object.assign(new Error("DPAPI verification failed"), { code: "VAULT_VERIFY_FAILED" }); }
    return id;
  }
  get(id) {
    const record = this.value.secrets[String(id || "")];
    if (!record?.ciphertext) throw Object.assign(new Error("Hardware secret reference is missing"), { code: "HARDWARE_SECRET_MISSING" });
    try { return this.protector.unprotect(record.ciphertext); }
    catch { throw Object.assign(new Error("Hardware secret cannot be decrypted for this Windows account"), { code: "HARDWARE_SECRET_DECRYPT_FAILED" }); }
  }
  delete(id) { if (!this.value.secrets[id]) return false; const next = structuredClone(this.value); delete next.secrets[id]; atomicWriteJson(this.file, next); this.value = next; return true; }
  publicStatus() { return { protection: this.value.protection, secretCount: Object.keys(this.value.secrets).length, healthy: true }; }
}

function purgePlaintextArtifacts(recordFile) {
  const directory = path.dirname(recordFile), base = path.basename(recordFile);
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    if (name === `${base}.bak` || name.startsWith(`${base}.tmp-`) || name.startsWith(`${base}.corrupt-`)) {
      try { const text = fs.readFileSync(path.join(directory, name), "utf8"); if (/"apiKey"\s*:/.test(text)) fs.unlinkSync(path.join(directory, name)); } catch {}
    }
  }
}
module.exports = { HardwareSecretVault, purgePlaintextArtifacts, validVault };
