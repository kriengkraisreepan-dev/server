const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { FlasherError } = require("./firmware-package-service");

const KEY_ID_RE = /^lrc-prod-(\d{4})-(\d{2})-([A-F0-9]{12})$/;
function publicKeyFingerprint(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : crypto.createPublicKey(publicKey), der = key.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex").toUpperCase();
}
function assertKeyId(keyId, publicKey) {
  const match = String(keyId || "").match(KEY_ID_RE), fingerprint = publicKeyFingerprint(publicKey);
  if (!match || match[3] !== fingerprint.slice(0, 12)) throw new FlasherError("SIGNING_KEY_ID_INVALID", "Signing Key ID ไม่ตรงกับ public key fingerprint", 409);
  return fingerprint;
}
class FirmwareProductionTrustStore {
  constructor({ registry, file = path.join(__dirname, "..", "config", "firmware-production-trust.json") } = {}) {
    this.registry = registry || JSON.parse(fs.readFileSync(file, "utf8"));
    if (this.registry.schemaVersion !== 1 || !Array.isArray(this.registry.keys) || !Array.isArray(this.registry.revokedKeys)) throw new FlasherError("TRUST_STORE_INVALID", "Production trust store ไม่ถูกต้อง", 500);
  }
  resolve(keyId, createdAt) {
    const record = this.registry.keys.find(item => item.keyId === keyId);
    if (!record) throw new FlasherError("SIGNING_KEY_UNKNOWN", "Signing key ไม่อยู่ใน Production allowlist", 409);
    const fingerprint = assertKeyId(record.keyId, record.publicKeyPem);
    if (record.fingerprintSha256 && record.fingerprintSha256 !== fingerprint) throw new FlasherError("TRUST_STORE_INVALID", "Public key fingerprint ใน trust store ไม่ตรงกัน", 500);
    const signedAt = Date.parse(createdAt), from = Date.parse(record.validFrom), until = Date.parse(record.validUntil);
    if (!Number.isFinite(signedAt) || !Number.isFinite(from) || !Number.isFinite(until) || signedAt < from || signedAt > until) throw new FlasherError("SIGNING_KEY_OUTSIDE_VALIDITY", "Signing key อยู่นอกช่วง rotation/overlap ที่อนุมัติ", 409);
    const revoked = this.registry.revokedKeys.find(item => item.keyId === keyId);
    if (revoked && (revoked.revokeAll === true || signedAt >= Date.parse(revoked.revokedAt))) throw new FlasherError("SIGNING_KEY_REVOKED", "Signing key ถูกเพิกถอนแล้ว", 409);
    return { ...record, fingerprintSha256: fingerprint };
  }
}
module.exports = { FirmwareProductionTrustStore, publicKeyFingerprint, assertKeyId, KEY_ID_RE };
