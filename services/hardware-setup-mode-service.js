const crypto = require("crypto");
const { HardwareError } = require("../drivers/relay-controller-driver");

const BASE31_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateBase31SetupCode(randomBytes = crypto.randomBytes) {
  const symbols = [];
  while (symbols.length < 12) {
    let bytes;
    try { bytes = randomBytes(24); } catch { throw new HardwareError("SECURE_RANDOM_UNAVAILABLE", "ไม่สามารถสร้าง Setup Code อย่างปลอดภัยได้", 503); }
    if (!Buffer.isBuffer(bytes) || bytes.length !== 24) throw new HardwareError("SECURE_RANDOM_UNAVAILABLE", "ไม่สามารถสร้าง Setup Code อย่างปลอดภัยได้", 503);
    for (const byte of bytes) {
      if (byte >= 248) continue; // Rejection sampling: 248 is exactly 31 * 8.
      symbols.push(BASE31_ALPHABET[byte % 31]);
      if (symbols.length === 12) break;
    }
  }
  const raw = symbols.join("");
  return { raw, display: `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}` };
}

class HardwareSetupModeService {
  constructor({ hardwareService, driver, enabled = () => true, audit = () => {}, randomBytes = crypto.randomBytes }) {
    Object.assign(this, { hardwareService, driver, enabled, audit, randomBytes });
  }
  requireEnabled() {
    if (!this.enabled()) throw new HardwareError("SETUP_AP_DISABLED", "ยังไม่ได้เปิดใช้งาน Setup AP", 404);
  }
  async requireRelaySafe(device) {
    const response = await this.driver.relays(device);
    const activeChannels = (response.relays || []).filter(relay => relay.state === "ON").map(relay => relay.channel);
    if (activeChannels.length) throw Object.assign(new HardwareError("RELAY_SAFE_STATE_CONFLICT", `กรุณาปิด Relay ช่อง ${activeChannels.join(", ")} ผ่านขั้นตอนปกติก่อน`, 409), { activeChannels });
  }
  async enroll(deviceRecordId, actorId) {
    this.requireEnabled();
    const device = this.hardwareService.getRequired(deviceRecordId);
    if (!device.hasUniqueDeviceKey && !device.apiKey) throw new HardwareError("UNIQUE_DEVICE_KEY_REQUIRED", "ต้องสร้างรหัสอุปกรณ์เฉพาะกล่องก่อน", 409);
    await this.requireRelaySafe(device);
    const { raw, display } = generateBase31SetupCode(this.randomBytes);
    const transitionId = crypto.randomUUID();
    this.audit("SETUP_CODE_ENROLLMENT_STARTED", actorId, { deviceId: deviceRecordId });
    try {
      await this.driver.stageSetupCode(device, transitionId, raw);
      const proof = await this.driver.verifySetupCode(device, transitionId, raw);
      if (proof.deviceId !== device.deviceId) throw new HardwareError("DEVICE_ID_MISMATCH", "Device ID ไม่ตรงระหว่างสร้าง Setup Code", 409);
      await this.driver.commitSetupCode(device, transitionId);
      this.hardwareService.repository.update(deviceRecordId, { hasSetupCode: true, setupCodeMasked: "****-****-****", setupCodeAcknowledged: false, setupCodeRotatedAt: new Date().toISOString() });
      this.audit("SETUP_CODE_ENROLLMENT_COMMITTED", actorId, { deviceId: deviceRecordId });
      return { committed: true, setupCode: display, displayOnce: true, acknowledgementRequired: true };
    } catch (error) {
      try { await this.driver.rollbackSetupCode(device, transitionId); } catch {}
      throw error;
    }
  }
  acknowledge(deviceRecordId, actorId) {
    this.requireEnabled();
    const device = this.hardwareService.getRequired(deviceRecordId);
    if (!device.hasSetupCode) throw new HardwareError("SETUP_CODE_REQUIRED", "ยังไม่มี Setup Code", 409);
    this.hardwareService.repository.update(deviceRecordId, { setupCodeAcknowledged: true, setupCodeAcknowledgedAt: new Date().toISOString() });
    this.audit("SETUP_CODE_RECORDED", actorId, { deviceId: deviceRecordId });
    return { acknowledged: true };
  }
  async status(deviceRecordId) {
    this.requireEnabled();
    const device = this.hardwareService.getRequired(deviceRecordId);
    return this.driver.setupModeStatus(device);
  }
  async start(deviceRecordId, confirmed, actorId) {
    this.requireEnabled();
    if (confirmed !== true) throw new HardwareError("EXPLICIT_CONFIRMATION_REQUIRED", "กรุณายืนยันว่า Relay ทุกช่องปิดอยู่", 400);
    const device = this.hardwareService.getRequired(deviceRecordId);
    await this.requireRelaySafe(device);
    const result = await this.driver.startSetupMode(device, true);
    this.audit("SETUP_MODE_REQUESTED", actorId, { deviceId: deviceRecordId });
    return result;
  }
  async stop(deviceRecordId, actorId) {
    this.requireEnabled();
    const result = await this.driver.stopSetupMode(this.hardwareService.getRequired(deviceRecordId));
    this.audit("SETUP_MODE_STOPPED", actorId, { deviceId: deviceRecordId });
    return result;
  }
}

module.exports = { HardwareSetupModeService, BASE31_ALPHABET, generateBase31SetupCode };
