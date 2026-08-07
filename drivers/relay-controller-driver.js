const { SUPPORTED_RELAY_COUNTS } = require("../domain/hardware-device");
const crypto = require("crypto");

class HardwareError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class RelayControllerDriver {
  constructor({ fetcher = fetch, timeoutMs = 3000 } = {}) {
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }
  endpoint(device) {
    const ip = String(device.ipAddress || "").trim();
    const parts = ip.split(".");
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
      throw new HardwareError("INVALID_IP", "IP Address ไม่ถูกต้อง");
    }
    const port = Number(device.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HardwareError("INVALID_PORT", "Port ไม่ถูกต้อง");
    return `http://${ip}:${port}`;
  }
  async request(device, route, { method = "GET", body, signal, timeoutMs, authenticated = false } = {}) {
    const headers = { Accept: "application/json" };
    if (method !== "GET" || authenticated) {
      headers["Content-Type"] = "application/json";
      headers["X-Lucky-Device-Key"] = device.apiKey;
    }
    let response;
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs || this.timeoutMs);
      const requestSignal = signal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      response = await this.fetcher(`${this.endpoint(device)}${route}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestSignal
      });
    } catch (error) {
      const code = error?.name === "TimeoutError" || error?.name === "AbortError" ? "DEVICE_TIMEOUT" : "DEVICE_OFFLINE";
      throw new HardwareError(code, code === "DEVICE_TIMEOUT" ? "อุปกรณ์ไม่ตอบสนองภายในเวลาที่กำหนด" : "ไม่สามารถเชื่อมต่ออุปกรณ์ได้", 503);
    }
    let payload;
    try { payload = await response.json(); } catch { throw new HardwareError("MALFORMED_DEVICE_RESPONSE", "อุปกรณ์ตอบกลับข้อมูลไม่ถูกต้อง", 502); }
    if (!response.ok) {
      if (response.status === 401) throw new HardwareError("DEVICE_AUTH_FAILED", "API Key ของอุปกรณ์ไม่ถูกต้อง", 401);
      throw new HardwareError(payload?.error?.code || "DEVICE_API_ERROR", payload?.error?.message || "อุปกรณ์ปฏิเสธคำสั่ง", 502);
    }
    if (!payload || typeof payload !== "object") throw new HardwareError("MALFORMED_DEVICE_RESPONSE", "อุปกรณ์ตอบกลับข้อมูลไม่ถูกต้อง", 502);
    return payload;
  }
  async probe(device, options = {}) {
    const [health, identity, config, relays] = await Promise.all([
      this.request(device, "/api/v1/health", options),
      this.request(device, "/api/v1/device", options),
      this.request(device, "/api/v1/config/relay", options),
      this.request(device, "/api/v1/relays", options)
    ]);
    if (String(identity.apiVersion) !== "1") throw new HardwareError("API_VERSION_MISMATCH", "เวอร์ชัน API ของอุปกรณ์ไม่รองรับ", 409);
    if (!SUPPORTED_RELAY_COUNTS.includes(Number(config.relayCount))) throw new HardwareError("INVALID_RELAY_COUNT", "จำนวน Relay ของอุปกรณ์ไม่ถูกต้อง", 409);
    return { health, identity, config, relays };
  }
  health(device, options = {}) { return this.request(device, "/api/v1/health", options); }
  relays(device) { return this.request(device, "/api/v1/relays"); }
  relayConfig(device) { return this.request(device, "/api/v1/config/relay"); }
  async verifyDevice(device, nonce = crypto.randomBytes(24).toString("hex")) {
    const result = await this.request(device, "/api/v1/device/verify", { method: "POST", body: { nonce } });
    const migrationVersion = Number(result.identityMigrationVersion || 0);
    const expected = crypto.createHmac("sha256", device.apiKey)
      .update(`${nonce}:${result.deviceId}:${migrationVersion}`).digest("hex");
    const actual = String(result.proof || "");
    if (result.nonce !== nonce || actual.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
      throw new HardwareError("DEVICE_VERIFY_PROOF_INVALID", "อุปกรณ์ตอบกลับการยืนยันไม่ถูกต้อง", 502);
    }
    return result;
  }
  stageDeviceKey(device, transitionId, newKey) { return this.request(device, "/api/v1/device/key/candidate", { method: "POST", body: { transitionId, newKey } }); }
  commitDeviceKey(device, transitionId) { return this.request(device, "/api/v1/device/key/commit", { method: "POST", body: { transitionId } }); }
  rollbackDeviceKey(device, transitionId) { return this.request(device, "/api/v1/device/key/rollback", { method: "POST", body: { transitionId } }); }
  wifiNetworks(device) { return this.request(device, "/api/v1/wifi/networks", { authenticated: true, timeoutMs: 15000 }); }
  wifiStatus(device) { return this.request(device, "/api/v1/wifi/provisioning/status", { authenticated: true }); }
  stageWifiCandidate(device, transitionId, ssid, password) { return this.request(device, "/api/v1/wifi/provisioning/candidate", { method: "POST", body: { transitionId, ssid, password } }); }
  commitWifi(device, transitionId) { return this.request(device, "/api/v1/wifi/provisioning/commit", { method: "POST", body: { transitionId } }); }
  rollbackWifi(device, transitionId) { return this.request(device, "/api/v1/wifi/provisioning/rollback", { method: "POST", body: { transitionId } }); }
  stageSetupCode(device, transitionId, setupCode) { return this.request(device, "/api/v1/setup/code/candidate", { method: "POST", body: { transitionId, setupCode } }); }
  async verifySetupCode(device, transitionId, setupCode, nonce = crypto.randomBytes(24).toString("hex")) {
    const result = await this.request(device, "/api/v1/setup/code/verify", { method: "POST", body: { transitionId, nonce } });
    const expected = crypto.createHmac("sha256", setupCode).update(`${nonce}:${result.deviceId}:0`).digest("hex");
    const actual = String(result.proof || "");
    if (result.nonce !== nonce || result.transitionId !== transitionId || actual.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new HardwareError("SETUP_CODE_PROOF_INVALID", "อุปกรณ์ยืนยัน Setup Code ไม่สำเร็จ", 502);
    return result;
  }
  commitSetupCode(device, transitionId) { return this.request(device, "/api/v1/setup/code/commit", { method: "POST", body: { transitionId } }); }
  rollbackSetupCode(device, transitionId) { return this.request(device, "/api/v1/setup/code/rollback", { method: "POST", body: { transitionId } }); }
  setupModeStatus(device) { return this.request(device, "/api/v1/setup/mode/status", { authenticated: true }); }
  startSetupMode(device, confirmed) { return this.request(device, "/api/v1/setup/mode/start", { method: "POST", body: { confirmed } }); }
  stopSetupMode(device) { return this.request(device, "/api/v1/setup/mode/stop", { method: "POST", body: {} }); }
  setRelayCount(device, relayCount) {
    if (!SUPPORTED_RELAY_COUNTS.includes(Number(relayCount))) throw new HardwareError("INVALID_RELAY_COUNT", "Relay Count ต้องเป็น 2, 4 หรือ 8");
    return this.request(device, "/api/v1/config/relay", { method: "POST", body: { relayCount: Number(relayCount) } });
  }
  setRelayState(device, relayId, state) {
    const channel = Number(relayId);
    if (!Number.isInteger(channel) || channel < 1 || channel > Number(device.relayCount)) {
      throw new HardwareError("INVALID_RELAY_CHANNEL", "ช่อง Relay ไม่ถูกต้อง");
    }
    return this.request(device, `/api/v1/relays/${channel}/state`, { method: "POST", body: { state: state ? "ON" : "OFF" } });
  }
  allOff(device) { return this.request(device, "/api/v1/relays/all/off", { method: "POST", body: {} }); }
}

module.exports = { RelayControllerDriver, HardwareError };
