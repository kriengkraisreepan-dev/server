const crypto = require("crypto");
const { HardwareError } = require("../drivers/relay-controller-driver");

const HARDWARE_STANDARD = "LHS-1.0";
const GPIO_MAPPING = Object.freeze([
  { relayChannel: 1, gpio: 13, inputLabel: "IN1" },
  { relayChannel: 2, gpio: 14, inputLabel: "IN2" },
  { relayChannel: 3, gpio: 16, inputLabel: "IN3" },
  { relayChannel: 4, gpio: 17, inputLabel: "IN4" },
  { relayChannel: 5, gpio: 18, inputLabel: "IN5" },
  { relayChannel: 6, gpio: 19, inputLabel: "IN6" },
  { relayChannel: 7, gpio: 25, inputLabel: "IN7" },
  { relayChannel: 8, gpio: 26, inputLabel: "IN8" },
]);
const RESULTS = new Set(["VERIFIED", "MISMATCH", "UNCERTAIN", "SKIPPED"]);
const REQUIRED_CONFIRMATIONS = ["tablesClosed", "noActiveSessions", "mainsDisconnected", "relaysOff", "readyForSingleChannelTest"];

function wiringError(code, message, status = 409, details) {
  return Object.assign(new HardwareError(code, message, status), details || {});
}
function defaultWait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(wiringError("WIRING_TEST_CANCELLED", "ยกเลิกการทดสอบแล้ว")); }, { once: true });
  });
}

class HardwareWiringAssistantService {
  constructor({ hardwareService, driver, tables = () => [], hasActiveTableSession = () => false, conflict = async () => null, audit = () => {}, wait = defaultWait, clock = () => new Date(), pulseMs = 1000, sessionTtlMs = 600000 } = {}) {
    Object.assign(this, { hardwareService, driver, tables, hasActiveTableSession, conflict, audit, wait, clock });
    if (!Number.isInteger(pulseMs) || pulseMs < 100 || pulseMs > 2000) throw wiringError("WIRING_PULSE_CONFIG_INVALID", "ค่าระยะเวลาทดสอบไม่ปลอดภัย", 500);
    this.pulseMs = pulseMs; this.sessionTtlMs = sessionTtlMs; this.sessions = new Map(); this.activeSessionId = null;
  }
  mapping(count) { return GPIO_MAPPING.slice(0, Number(count)); }
  device(id) {
    const device = this.hardwareService.getRequired(id);
    const duplicates = this.hardwareService.repository.list().filter(item => item.deviceId === device.deviceId);
    if (!device.deviceId || duplicates.length !== 1) throw wiringError("DEVICE_ID_AMBIGUOUS", "พบ Device ID ซ้ำหรือไม่สมบูรณ์ กรุณาตรวจสอบข้อมูลอุปกรณ์", 409);
    return device;
  }
  publicSession(session) {
    return { id: session.id, deviceRecordId: session.deviceRecordId, deviceId: session.deviceId, state: session.state, relayCount: session.relayCount, mapping: session.mapping, results: session.results, currentChannel: session.currentChannel || null, emergency: session.emergency || null, startedAt: session.startedAt };
  }
  view(id) {
    const device = this.device(id);
    return { device: this.hardwareService.publicDevice(device), hardwareStandard: HARDWARE_STANDARD, mapping: this.mapping(device.relayCount), wiringProfile: device.wiringProfile || null, tableMappings: this.tables().filter(table => table.hardwareDeviceId === id).map(table => ({ tableId: table.id, tableName: table.name, relayChannel: table.relayChannel })) };
  }
  async assertSafe(device) {
    if (device.status !== "ONLINE") throw wiringError("DEVICE_OFFLINE", "อุปกรณ์ Offline ไม่สามารถเริ่มตรวจสายได้", 503);
    if (device.hasUniqueDeviceKey !== true) throw wiringError("UNIQUE_DEVICE_KEY_REQUIRED", "ต้องสร้างรหัสอุปกรณ์เฉพาะกล่องก่อน", 409);
    if (this.tables().some(table => table.hardwareDeviceId === device.id && this.hasActiveTableSession(table.id))) throw wiringError("ACTIVE_TABLE_SESSION", "ยังมี Active Table Session ที่ผูกกับกล่องนี้", 409);
    const conflict = await this.conflict(device.id);
    if (conflict) throw wiringError("HARDWARE_OPERATION_CONFLICT", `มี ${conflict} กำลังทำงานอยู่`, 409);
    const state = await this.driver.relays(device);
    const activeChannels = (state.relays || []).filter(relay => relay.state === "ON").map(relay => relay.channel);
    if (activeChannels.length) throw wiringError("RELAY_SAFE_STATE_CONFLICT", `กรุณาปิด Relay ช่อง ${activeChannels.join(", ")} ผ่าน workflow ปกติก่อน`, 409, { activeChannels });
  }
  async start(deviceRecordId, confirmations, actorId) {
    if (this.activeSessionId) throw wiringError("WIRING_TEST_BUSY", "มี Wiring Test session อื่นกำลังทำงานอยู่", 409);
    if (!confirmations || !REQUIRED_CONFIRMATIONS.every(key => confirmations[key] === true)) throw wiringError("SAFETY_CONFIRMATION_REQUIRED", "กรุณายืนยันคำเตือนความปลอดภัยให้ครบทุกข้อ", 400);
    const device = this.device(deviceRecordId); await this.assertSafe(device);
    const session = { id: `wiring-${crypto.randomUUID()}`, deviceRecordId, deviceId: device.deviceId, relayCount: Number(device.relayCount), firmwareVersion: device.firmwareVersion || null, hardwareStandard: HARDWARE_STANDARD, mapping: this.mapping(device.relayCount).map(item => ({ ...item, verificationStatus: "NOT_TESTED" })), results: {}, state: "READY", actorId, startedAt: this.clock().toISOString(), controller: new AbortController() };
    this.sessions.set(session.id, session); this.activeSessionId = session.id;
    session.expiryTimer = setTimeout(() => { session.cancelRequested = true; session.controller?.abort(); session.state = "CANCELLED"; if (this.activeSessionId === session.id) this.activeSessionId = null; this.audit("WIRING_TEST_CANCELLED", "SYSTEM", { deviceId: session.deviceRecordId, controllerDeviceId: session.deviceId, errorCategory: "SESSION_TIMEOUT" }); }, this.sessionTtlMs);
    session.expiryTimer.unref?.();
    this.audit("WIRING_ASSISTANT_STARTED", actorId, { deviceId: device.id, controllerDeviceId: device.deviceId, relayCount: session.relayCount });
    return this.publicSession(session);
  }
  requireSession(deviceRecordId, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.deviceRecordId !== deviceRecordId || session.deviceId !== this.device(deviceRecordId).deviceId) throw wiringError("WIRING_SESSION_INVALID", "Wiring Test session ไม่ถูกต้องหรือหมดอายุ", 404);
    if (session.state === "EMERGENCY_LOCKED") throw wiringError("RELAY_TEST_OFF_FAILED", "Wiring Test ถูกล็อก กรุณาตัดไฟแรงดันต่ำหรือ USB ของ Relay controller", 503, { emergency: session.emergency });
    return session;
  }
  async test(deviceRecordId, sessionId, input, actorId) {
    const session = this.requireSession(deviceRecordId, sessionId);
    if (session.state !== "READY") throw wiringError("WIRING_TEST_BUSY", "กำลังทดสอบ Relay ช่องอื่นอยู่", 409);
    if (Object.prototype.hasOwnProperty.call(input || {}, "gpio")) throw wiringError("CLIENT_GPIO_FORBIDDEN", "Backend เป็นผู้กำหนด GPIO เท่านั้น", 400);
    if (Object.prototype.hasOwnProperty.call(input || {}, "durationMs")) throw wiringError("CLIENT_PULSE_DURATION_FORBIDDEN", "ไม่อนุญาตให้ Browser กำหนดระยะเวลา pulse", 400);
    const channel = Number(input?.channel);
    if (!Number.isInteger(channel) || channel < 1 || channel > session.relayCount) throw wiringError("INVALID_RELAY_CHANNEL", "ช่อง Relay ไม่ถูกต้อง", 400);
    const device = this.device(deviceRecordId); await this.assertSafe(device);
    const map = session.mapping[channel - 1]; session.state = "PULSING"; session.currentChannel = channel; session.controller = new AbortController();
    this.audit("WIRING_CHANNEL_TEST_STARTED", actorId, { deviceId: device.id, relayChannel: channel, gpio: map.gpio, durationMs: this.pulseMs });
    let ownsRelay = false, primaryError = null;
    try {
      await this.driver.setRelayState(device, channel, true); ownsRelay = true;
      await this.wait(this.pulseMs, session.controller.signal);
    } catch (error) { primaryError = error; }
    finally {
      if (ownsRelay) {
        try {
          await this.driver.setRelayState(device, channel, false);
          const after = await this.driver.relays(device), target = (after.relays || []).find(relay => Number(relay.channel) === channel);
          if (!target || target.state !== "OFF") throw wiringError("RELAY_TEST_OFF_FAILED", "ไม่สามารถยืนยันว่า Relay ปิดแล้ว", 503);
        } catch (offError) {
          session.state = "EMERGENCY_LOCKED"; session.emergency = { code: "RELAY_TEST_OFF_FAILED", channel, message: "ตัดไฟแรงดันต่ำหรือ USB ของ Relay controller ทันที และห้ามทดสอบช่องถัดไป" };
          this.audit("RELAY_TEST_OFF_FAILED", actorId, { deviceId: device.id, relayChannel: channel, gpio: map.gpio, errorCategory: offError.code || "DEVICE_ERROR" });
          throw wiringError("RELAY_TEST_OFF_FAILED", session.emergency.message, 503, { emergency: session.emergency });
        }
      }
      session.currentChannel = null;
    }
    if (primaryError) {
      session.state = session.cancelRequested ? "CANCELLED" : "READY";
      if (session.cancelRequested) { clearTimeout(session.expiryTimer); if (this.activeSessionId === session.id) this.activeSessionId = null; }
      throw primaryError;
    }
    session.state = "AWAITING_RESULT"; session.awaitingChannel = channel;
    this.audit("WIRING_CHANNEL_PULSE_COMPLETED", actorId, { deviceId: device.id, relayChannel: channel, gpio: map.gpio, durationMs: this.pulseMs });
    return this.publicSession(session);
  }
  result(deviceRecordId, sessionId, input, actorId) {
    const session = this.requireSession(deviceRecordId, sessionId), channel = Number(input?.channel), status = String(input?.status || "").toUpperCase();
    if (session.state !== "AWAITING_RESULT" || channel !== session.awaitingChannel) throw wiringError("WIRING_RESULT_NOT_EXPECTED", "ยังไม่มีผลทดสอบของช่องนี้ให้บันทึก", 409);
    if (!RESULTS.has(status)) throw wiringError("WIRING_RESULT_INVALID", "ผลการตรวจสายไม่ถูกต้อง", 400);
    let actualChannel = null;
    if (status === "MISMATCH") { actualChannel = Number(input?.actualChannel); if (!Number.isInteger(actualChannel) || actualChannel < 1 || actualChannel > session.relayCount || actualChannel === channel) throw wiringError("ACTUAL_CHANNEL_INVALID", "กรุณาระบุช่องที่ทำงานจริง", 400); }
    const item = session.mapping[channel - 1]; item.verificationStatus = status; if (actualChannel) item.actualChannel = actualChannel;
    session.results[channel] = { status, actualChannel }; session.awaitingChannel = null; session.state = "READY";
    const event = { VERIFIED: "WIRING_CHANNEL_VERIFIED", MISMATCH: "WIRING_CHANNEL_MISMATCH", UNCERTAIN: "WIRING_CHANNEL_UNCERTAIN", SKIPPED: "WIRING_CHANNEL_UNCERTAIN" }[status];
    this.audit(event, actorId, { deviceId: deviceRecordId, relayChannel: channel, gpio: item.gpio, result: status, actualChannel });
    return this.publicSession(session);
  }
  complete(deviceRecordId, sessionId, actorId) {
    const session = this.requireSession(deviceRecordId, sessionId);
    if (session.state !== "READY") throw wiringError("WIRING_SESSION_BUSY", "ยังไม่สามารถบันทึกผลขณะ pulse ทำงาน", 409);
    for (const item of session.mapping) if (item.verificationStatus === "NOT_TESTED") item.verificationStatus = "SKIPPED";
    const profile = { schemaVersion: 1, hardwareStandard: HARDWARE_STANDARD, relayCount: session.relayCount, mapping: session.mapping.map(item => ({ ...item })), verificationStatus: session.mapping.every(item => item.verificationStatus === "VERIFIED") ? "VERIFIED" : session.mapping.some(item => item.verificationStatus === "MISMATCH") ? "MISMATCH" : "UNCERTAIN", verifiedAt: this.clock().toISOString(), verifiedBy: actorId, deviceIdAtVerification: session.deviceId, firmwareVersionAtVerification: session.firmwareVersion };
    this.hardwareService.repository.update(deviceRecordId, { wiringProfile: profile, lastWiringVerifiedAt: profile.verifiedAt });
    session.state = "COMPLETED"; clearTimeout(session.expiryTimer); this.activeSessionId = null;
    this.audit("WIRING_ASSISTANT_COMPLETED", actorId, { deviceId: deviceRecordId, controllerDeviceId: session.deviceId, result: profile.verificationStatus });
    return { wiringProfile: profile, sheet: this.view(deviceRecordId) };
  }
  async cancel(deviceRecordId, sessionId, actorId) {
    const session = this.requireSession(deviceRecordId, sessionId); session.cancelRequested = true; session.controller?.abort();
    if (session.state !== "PULSING") { session.state = "CANCELLED"; clearTimeout(session.expiryTimer); if (this.activeSessionId === session.id) this.activeSessionId = null; }
    this.audit("WIRING_TEST_CANCELLED", actorId, { deviceId: deviceRecordId, controllerDeviceId: session.deviceId, relayChannel: session.currentChannel || null });
    return { cancelled: true, state: session.state };
  }
}

module.exports = { HardwareWiringAssistantService, GPIO_MAPPING, HARDWARE_STANDARD };
