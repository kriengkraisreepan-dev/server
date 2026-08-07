const crypto = require("crypto");

class HardwareWifiProvisioningService {
  constructor({ hardwareService, discoveryService, driver, enabled = () => true, log = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() }) {
    Object.assign(this, { hardwareService, discoveryService, driver, enabled, log, wait, now });
    this.sessions = new Map();
  }
  requireEnabled() {
    if (!this.enabled()) throw Object.assign(Error("ยังไม่ได้เปิดใช้งานการตั้งค่า Wi-Fi"), { code: "WIFI_PROVISIONING_DISABLED", status: 404 });
  }
  publicSession(session) {
    return {
      id: session.id, deviceId: session.deviceId, state: session.state,
      message: session.message, errorCode: session.errorCode || null,
      startedAt: session.startedAt, completedAt: session.completedAt || null
    };
  }
  async networks(deviceRecordId) {
    this.requireEnabled();
    return this.hardwareService.wifiNetworks(deviceRecordId);
  }
  async start(deviceRecordId, { ssid, password, confirmedSafe }, actorId) {
    this.requireEnabled();
    const device = this.hardwareService.getRequired(deviceRecordId);
    if (!confirmedSafe) throw Object.assign(Error("กรุณายืนยันว่าไม่มีโต๊ะกำลังใช้งาน"), { code: "RELAY_SAFETY_CONFIRMATION_REQUIRED", status: 409 });
    const relays = await this.driver.relays(device);
    const active = (relays.relays || []).filter(item => item.state === "ON").map(item => item.channel);
    if (active.length) throw Object.assign(Error(`กรุณาปิด Relay ช่อง ${active.join(", ")} ผ่านการทำงานปกติก่อน`), { code: "RELAY_SAFE_STATE_CONFLICT", status: 409, activeChannels: active });
    const transitionId = crypto.randomUUID();
    const session = {
      id: `hwifi-${crypto.randomUUID()}`, deviceRecordId, deviceId: device.deviceId,
      transitionId, original: { ...device }, state: "SENDING_CANDIDATE",
      message: "กำลังส่งการตั้งค่า", startedAt: new Date(this.now()).toISOString()
    };
    this.sessions.set(session.id, session);
    await this.driver.stageWifiCandidate(device, transitionId, String(ssid || ""), String(password || ""));
    password = undefined;
    session.state = "CONNECTING_CANDIDATE"; session.message = "กล่องกำลังเชื่อมต่อ Wi-Fi ใหม่";
    this.log("INFO", "HARDWARE_WIFI_PROVISIONING_STARTED", { sessionId: session.id, deviceId: device.deviceId, actorId });
    this.run(session, actorId).catch(error => this.fail(session, error));
    return this.publicSession(session);
  }
  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw Object.assign(Error("ไม่พบรายการเปลี่ยน Wi-Fi"), { code: "WIFI_SESSION_NOT_FOUND", status: 404 });
    return this.publicSession(session);
  }
  isActiveForDevice(deviceRecordId) {
    return [...this.sessions.values()].some(session => session.deviceRecordId === deviceRecordId && !["COMPLETED", "FAILED", "CANCELLED"].includes(session.state));
  }
  async run(session, actorId) {
    const deadline = this.now() + 60000;
    session.state = "REDISCOVERING"; session.message = "กำลังค้นหากล่องอีกครั้ง";
    while (this.now() < deadline) {
      const discovery = this.discoveryService.start(actorId, { updateExisting: false });
      let current = discovery;
      while (!["COMPLETED", "FAILED", "CANCELLED"].includes(current.state) && this.now() < deadline) {
        await this.wait(500); current = this.discoveryService.get(discovery.id);
      }
      if (!current.results && current.id) current = this.discoveryService.get(current.id);
      const found = current.results?.find(item => item.deviceId === session.deviceId);
      if (found) {
        const candidate = { ...session.original, ipAddress: found.ipAddress, port: found.port };
        session.state = "VERIFYING"; session.message = "กำลังตรวจสอบตัวตนอุปกรณ์";
        await this.driver.verifyDevice(candidate);
        const status = await this.driver.wifiStatus(candidate);
        if (status.transitionId !== session.transitionId) throw Object.assign(Error("Transition ID ไม่ตรงกัน"), { code: "WIFI_TRANSITION_MISMATCH" });
        if (status.state === "WAITING_FOR_COMMIT") {
          await this.driver.commitWifi(candidate, session.transitionId);
          this.hardwareService.updateDiscoveredLocation(session.deviceRecordId, found, "WIFI_TRANSITION", { actorId });
          session.state = "COMPLETED"; session.message = "เปลี่ยน Wi-Fi สำเร็จ"; session.completedAt = new Date(this.now()).toISOString();
          session.original = undefined;
          this.log("INFO", "HARDWARE_WIFI_PROVISIONING_COMPLETED", { sessionId: session.id, deviceId: session.deviceId });
          return;
        }
        if (["ORIGINAL_NETWORK_RESTORED", "ROLLING_BACK"].includes(status.state)) throw Object.assign(Error("กล่องย้อนกลับเครือข่ายเดิมแล้ว"), { code: status.errorCode || "WIFI_ROLLED_BACK" });
      }
      await this.wait(1000);
    }
    throw Object.assign(Error("ค้นหา IP ใหม่ไม่สำเร็จภายในเวลาที่กำหนด"), { code: "WIFI_REDISCOVERY_TIMEOUT" });
  }
  async fail(session, error) {
    session.state = "FAILED"; session.errorCode = error.code || "WIFI_PROVISIONING_FAILED";
    session.message = session.errorCode === "RELAY_SAFE_STATE_CONFLICT" ? "Relay เปิดขึ้นระหว่างเปลี่ยนเครือข่าย ระบบกำลังย้อนกลับ" : "เชื่อมต่อไม่สำเร็จและย้อนกลับเครือข่ายเดิมแล้ว";
    session.completedAt = new Date(this.now()).toISOString();
    try { await this.driver.rollbackWifi(session.original, session.transitionId); } catch {}
    session.original = undefined;
    this.log("ERROR", "HARDWARE_WIFI_PROVISIONING_FAILED", { sessionId: session.id, deviceId: session.deviceId, errorCode: session.errorCode });
  }
}

module.exports = { HardwareWifiProvisioningService };
