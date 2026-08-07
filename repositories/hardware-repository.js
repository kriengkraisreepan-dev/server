const crypto = require("crypto");
const { atomicWriteJson, readJsonWithRecovery } = require("../infrastructure/safe-json-file");
const { purgePlaintextArtifacts } = require("../services/hardware-secret-vault");

class HardwareRepository {
  constructor(file, { secretVault = null } = {}) {
    this.file = file;
    this.secretVault = secretVault;
    this.devices = readJsonWithRecovery(file, { validate: Array.isArray, create: () => [] }).value;
    if (this.secretVault) this.loadSecretsAndMigrate();
  }
  loadSecretsAndMigrate() {
    const staged = [];
    try {
      for (const device of this.devices) {
        if (device.apiKey) { const secretId = this.secretVault.put(device.apiKey); staged.push({ device, secretId }); device.secretId = secretId; }
        if (!device.secretId && device.credentialStatus === "REAUTHENTICATION_REQUIRED") { delete device.apiKey; continue; }
        if (!device.secretId) throw Object.assign(new Error("Hardware record has no secret reference"), { code: "HARDWARE_SECRET_REFERENCE_MISSING" });
        const decrypted = this.secretVault.get(device.secretId);
        if (device.apiKey && decrypted !== device.apiKey) throw Object.assign(new Error("Migrated Hardware secret did not verify"), { code: "HARDWARE_SECRET_VERIFY_FAILED" });
        device.apiKey = decrypted;
      }
      if (staged.length) { this.save(); purgePlaintextArtifacts(this.file); }
    } catch (error) {
      for (const item of staged) { this.secretVault.delete(item.secretId); delete item.device.secretId; }
      throw error;
    }
  }
  list() { return this.devices; }
  findById(id) { return this.devices.find(device => device.id === id) || null; }
  serialized() { return this.devices.map(({ apiKey, ...record }) => record); }
  save() { atomicWriteJson(this.file, this.secretVault ? this.serialized() : this.devices); }
  stageSecret(device, secret) {
    if (!this.secretVault || typeof secret !== "string") return null;
    const previousId = device.secretId || null, secretId = this.secretVault.put(secret);
    device.secretId = secretId;
    return { previousId, secretId };
  }
  finishSecret(stage, success) {
    if (!stage || !this.secretVault) return;
    if (success) { if (stage.previousId) try { this.secretVault.delete(stage.previousId); } catch {} }
    else try { this.secretVault.delete(stage.secretId); } catch {}
  }
  create(data) {
    const device = { id: `hw-${crypto.randomUUID().slice(0, 8)}`, ...data };
    const stage = this.stageSecret(device, device.apiKey);
    this.devices.push(device);
    try { this.save(); this.finishSecret(stage, true); } catch (error) { this.devices.pop(); this.finishSecret(stage, false); throw error; }
    return device;
  }
  update(id, data) {
    const device = this.findById(id);
    if (!device) return null;
    const index = this.devices.indexOf(device);
    const before = structuredClone(device);
    const secretChanged = data.apiKey !== undefined && data.apiKey !== before.apiKey;
    const reverifyReasons = [];
    if (device.wiringProfile) {
      if (data.deviceId !== undefined && data.deviceId !== device.deviceId) reverifyReasons.push("DEVICE_ID_CHANGED");
      if (data.relayCount !== undefined && Number(data.relayCount) !== Number(device.relayCount)) reverifyReasons.push("RELAY_COUNT_CHANGED");
      if (data.hardwareStandard !== undefined && data.hardwareStandard !== device.hardwareStandard) reverifyReasons.push("HARDWARE_STANDARD_CHANGED");
    }
    Object.assign(device, data);
    const stage = secretChanged ? this.stageSecret(device, data.apiKey) : null;
    if (reverifyReasons.length) {
      device.wiringProfile = {
        ...device.wiringProfile,
        verificationStatus: "REVERIFY_REQUIRED",
        reverifyEventPending: true,
        reverifyReasons,
        reverifyRequiredAt: new Date().toISOString(),
        mapping: (device.wiringProfile.mapping || []).map(item => ({ ...item, verificationStatus: "REVERIFY_REQUIRED" }))
      };
    }
    try { this.save(); this.finishSecret(stage, true); } catch (error) { this.devices[index] = before; this.finishSecret(stage, false); throw error; }
    return device;
  }
  delete(id) {
    const index = this.devices.findIndex(device => device.id === id);
    if (index < 0) return false;
    const [removed] = this.devices.splice(index, 1);
    try { this.save(); } catch (error) { this.devices.splice(index, 0, removed); throw error; }
    if (this.secretVault && removed.secretId) this.secretVault.delete(removed.secretId);
    return true;
  }
  mutateAtomically(work) {
    const before = structuredClone(this.devices);
    try { const result = work(this.devices); this.save(); return result; }
    catch (error) { this.devices = before; throw error; }
  }
}

module.exports = { HardwareRepository };
