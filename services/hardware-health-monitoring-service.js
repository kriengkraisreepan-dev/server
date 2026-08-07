const HEALTH_STATUS = new Set(["HEALTHY", "OK", "ONLINE"]);
const ERROR_MESSAGES = Object.freeze({
  DEVICE_TIMEOUT: ["หมดเวลาติดต่อกล่องควบคุม", "ตรวจสายไฟและ Wi-Fi แล้วลองใหม่"],
  DEVICE_UNREACHABLE: ["ติดต่อกล่องควบคุมไม่สำเร็จ", "ตรวจสายไฟและ Wi-Fi แล้วลองใหม่"],
  DEVICE_HTTP_ERROR: ["กล่องควบคุมตอบกลับผิดพลาด", "ตรวจสอบสถานะกล่องแล้วลองใหม่"],
  DEVICE_RESPONSE_INVALID: ["ข้อมูลสุขภาพจากกล่องไม่ถูกต้อง", "ตรวจสอบ Firmware และลองใหม่"],
  DEVICE_ID_MISMATCH: ["ข้อมูลอุปกรณ์ไม่ตรงกับรายการที่บันทึกไว้", "ระบบหยุดการอัปเดตสถานะเพื่อป้องกันการเชื่อมผิดกล่อง"],
  RELAY_COUNT_MISMATCH: ["จำนวน Relay ไม่ตรงกับรายการที่บันทึกไว้", "ตรวจสอบกล่องและรายการ Hardware ก่อนดำเนินการต่อ"],
  WIFI_DISCONNECTED: ["กล่องควบคุมไม่ได้เชื่อมต่อ Wi-Fi", "ตรวจสอบเครือข่ายของกล่องแล้วลองใหม่"],
  HEALTH_CHECK_CANCELLED: ["ยกเลิกการตรวจสุขภาพแล้ว", "ลองตรวจใหม่เมื่อพร้อม"]
});

class HardwareHealthMonitoringService {
  constructor({ repository, driver, audit = () => {}, log = () => {}, now = () => new Date(), timeoutMs = 5000, offlineThreshold = 3, staleMs = 90000, backgroundIntervalMs = 60000, manualCooldownMs = 3000, maxConcurrent = 4, enabled = true } = {}) {
    Object.assign(this, { repository, driver, audit, log, now, timeoutMs, offlineThreshold, staleMs, backgroundIntervalMs, manualCooldownMs, maxConcurrent, enabled });
    this.inFlight = new Map();
    this.manualChecks = new Map();
    this.timer = null;
  }

  publicDevice(device) {
    if (!device) return null;
    const { apiKey, secretId, ...safe } = device;
    const last = Date.parse(device.lastCheckedAt || "");
    const publicRecord = { ...safe, apiKeyMasked: apiKey ? "••••••••" : "", hasApiKey: Boolean(apiKey) };
    if (Number.isFinite(last) && this.now().getTime() - last > this.staleMs && !["OFFLINE", "UNKNOWN"].includes(device.status)) return { ...publicRecord, status: "STALE" };
    return publicRecord;
  }

  validate(device, health) {
    if (!health || typeof health !== "object" || Array.isArray(health) ||
        typeof health.deviceId !== "string" || typeof health.status !== "string" ||
        typeof health.wifiConnected !== "boolean" || !Number.isInteger(Number(health.relayCount))) this.raise("DEVICE_RESPONSE_INVALID");
    if (health.deviceId !== device.deviceId) this.raise("DEVICE_ID_MISMATCH");
    if (Number(health.relayCount) !== Number(device.relayCount)) this.raise("RELAY_COUNT_MISMATCH");
    if (!HEALTH_STATUS.has(health.status.toUpperCase())) this.raise("DEVICE_RESPONSE_INVALID");
    if (!health.wifiConnected) this.raise("WIFI_DISCONNECTED");
    return health;
  }

  raise(code) {
    const error = new Error(ERROR_MESSAGES[code]?.[0] || "ตรวจสุขภาพอุปกรณ์ไม่สำเร็จ");
    error.code = code;
    throw error;
  }

  normalizeError(error) {
    const original = String(error?.code || "");
    const code = original === "DEVICE_TIMEOUT" ? "DEVICE_TIMEOUT"
      : ["MALFORMED_DEVICE_RESPONSE"].includes(original) ? "DEVICE_RESPONSE_INVALID"
      : ["DEVICE_API_ERROR", "DEVICE_AUTH_FAILED"].includes(original) ? "DEVICE_HTTP_ERROR"
      : ERROR_MESSAGES[original] ? original : "DEVICE_UNREACHABLE";
    const [message, recoverySuggestion] = ERROR_MESSAGES[code];
    return { code, message, recoverySuggestion };
  }

  async check(id, { manual = false } = {}) {
    if (!this.enabled) return this.publicDevice(this.repository.findById(id));
    const device = this.repository.findById(id);
    if (!device) this.raise("DEVICE_UNREACHABLE");
    if (device.credentialStatus === "REAUTHENTICATION_REQUIRED" || !device.apiKey) return this.publicDevice(device);
    if (manual) {
      const previous = this.manualChecks.get(id) || 0, nowMs = this.now().getTime();
      if (this.manualChecks.has(id) && nowMs - previous < this.manualCooldownMs) {
        const error = new Error("กรุณารอ 3 วินาทีก่อนตรวจซ้ำ"); error.code = "HEALTH_CHECK_COOLDOWN"; throw error;
      }
      this.manualChecks.set(id, nowMs);
    }
    if (this.inFlight.has(id)) return this.inFlight.get(id);
    const promise = this.perform(device).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, promise);
    return promise;
  }

  async perform(device) {
    const started = this.now().getTime(), previousStatus = device.status || "UNKNOWN";
    this.log("DEBUG", "HARDWARE_HEALTH_CHECK_STARTED", { hardwareRecordId: device.id, deviceId: device.deviceId, ip: device.ipAddress });
    try {
      const health = this.validate(device, await this.driver.health(device, { timeoutMs: this.timeoutMs }));
      const completed = this.now(), latencyMs = Math.max(0, completed.getTime() - started);
      const fields = { status: "ONLINE", lastSeen: completed.toISOString(), lastOnlineAt: completed.toISOString(), lastCheckedAt: completed.toISOString(), lastErrorCode: null, consecutiveFailures: 0, firmwareVersion: health.firmwareVersion || device.firmwareVersion, relayCount: Number(health.relayCount), health: { uptimeSeconds: health.uptimeSeconds ?? health.uptime, rssi: health.rssi, freeHeapBytes: health.freeHeapBytes, latencyMs }, updatedAt: completed.toISOString() };
      const updated = this.repository.update(device.id, fields);
      if (previousStatus !== "ONLINE") {
        this.audit("HARDWARE_STATUS_RECOVERED", "SYSTEM", { deviceId: device.id, controllerDeviceId: device.deviceId, previousStatus, newStatus: "ONLINE", durationMs: latencyMs });
        this.log("INFO", "HARDWARE_HEALTH_CHECK_SUCCEEDED", { hardwareRecordId: device.id, deviceId: device.deviceId, ip: device.ipAddress, durationMs: latencyMs, previousStatus, newStatus: "ONLINE" });
      }
      return this.publicDevice(updated);
    } catch (rawError) {
      const error = this.normalizeError(rawError), completed = this.now(), failures = Number(device.consecutiveFailures || 0) + 1;
      const mismatch = ["DEVICE_ID_MISMATCH", "RELAY_COUNT_MISMATCH"].includes(error.code);
      const status = mismatch ? "UNKNOWN" : failures >= this.offlineThreshold ? "OFFLINE" : error.code === "DEVICE_TIMEOUT" ? "TIMEOUT" : "UNKNOWN";
      const updated = this.repository.update(device.id, { status, lastCheckedAt: completed.toISOString(), lastErrorCode: error.code, consecutiveFailures: failures, healthRecoverySuggestion: error.recoverySuggestion, updatedAt: completed.toISOString() });
      const event = mismatch ? "HARDWARE_IDENTITY_MISMATCH" : error.code === "DEVICE_TIMEOUT" ? "HARDWARE_HEALTH_CHECK_TIMEOUT" : "HARDWARE_STATUS_CHANGED";
      this.log(mismatch ? "ERROR" : "WARN", event, { hardwareRecordId: device.id, deviceId: device.deviceId, ip: device.ipAddress, result: error.code, durationMs: Math.max(0, completed.getTime() - started), previousStatus, newStatus: status, failureCount: failures });
      if (status !== previousStatus || mismatch) this.audit(event, "SYSTEM", { deviceId: device.id, controllerDeviceId: device.deviceId, result: error.code, previousStatus, newStatus: status, failureCount: failures });
      return this.publicDevice(updated);
    }
  }

  async checkAll() {
    const ids = this.repository.list().map(device => device.id), results = [];
    let cursor = 0;
    const worker = async () => { while (cursor < ids.length) { const index = cursor++; results[index] = await this.check(ids[index]); } };
    await Promise.all(Array.from({ length: Math.min(this.maxConcurrent, ids.length) }, worker));
    return results;
  }

  start() {
    if (!this.enabled || this.timer) return false;
    this.timer = setInterval(() => this.checkAll().catch(error => this.log("ERROR", "HARDWARE_HEALTH_POLL_FAILED", { errorCode: error.code || "HEALTH_POLL_FAILED" })), this.backgroundIntervalMs);
    this.timer.unref?.();
    return true;
  }

  stop() { if (!this.timer) return false; clearInterval(this.timer); this.timer = null; return true; }
}

module.exports = { HardwareHealthMonitoringService, ERROR_MESSAGES };
