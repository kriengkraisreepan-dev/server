const crypto = require("crypto");
const { FlasherError } = require("./firmware-package-service");

class HardwareEnrollmentHandoffService {
  constructor({ flasher, discovery, driver, hardwareService, wizardService, audit = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), clock = () => Date.now(), discoveryTimeoutMs = 60000, randomBytes = crypto.randomBytes } = {}) {
    Object.assign(this, { flasher, discovery, driver, hardwareService, wizardService, audit, wait, clock, discoveryTimeoutMs, randomBytes });
  }
  operation(operationId, actorId) {
    const op = this.flasher.active;
    if (!op || op.id !== operationId) throw new FlasherError("FLASH_OPERATION_NOT_FOUND", "ไม่พบ Enrollment operation นี้ อาจเกิดจาก Server ถูกปิดหรือเริ่มใหม่", 404);
    if (op.actorId !== actorId) throw new FlasherError("ENROLLMENT_ACTOR_MISMATCH", "Enrollment operation นี้เป็นของผู้ดูแลคนอื่น", 403);
    if (op.mode !== "new" || op.state !== "ENROLLMENT_PENDING" || !op.pendingEnrollment?.deviceKey) throw new FlasherError("ENROLLMENT_NOT_PENDING", "Operation นี้ไม่มีข้อมูล Enrollment ที่ใช้งานได้", 409);
    if (op.enrollmentExpiresAt <= this.clock()) throw new FlasherError("ENROLLMENT_EXPIRED", "Enrollment หมดอายุและข้อมูลลับไม่สามารถกู้คืนได้", 410);
    return op;
  }
  issueToken(operationId, actorId) {
    const op = this.operation(operationId, actorId), token = this.randomBytes(32).toString("base64url");
    op.pendingEnrollment.tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    op.pendingEnrollment.tokenExpiresAt = this.clock() + 120000;
    return { enrollmentToken: token, expiresInSeconds: 120, operationId: op.id };
  }
  consumeToken(op, token) {
    const supplied = crypto.createHash("sha256").update(String(token || "")).digest("hex"), expected = op.pendingEnrollment.tokenHash, expiresAt = op.pendingEnrollment.tokenExpiresAt;
    delete op.pendingEnrollment.tokenHash; delete op.pendingEnrollment.tokenExpiresAt;
    if (!expected || expiresAt < this.clock() || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new FlasherError("ENROLLMENT_TOKEN_INVALID", "สิทธิ์ Enrollment หมดอายุหรือถูกใช้แล้ว", 403);
  }
  begin(operationId, actorId, token) {
    const op = this.operation(operationId, actorId);
    if (op.enrollmentRunning) throw new FlasherError("ENROLLMENT_BUSY", "กำลังค้นหาและตรวจสอบกล่องอยู่", 409);
    this.consumeToken(op, token); op.enrollmentRunning = true; op.enrollmentState = "DISCOVERING"; op.enrollmentMessage = "กำลังค้นหากล่องใหม่หลังตั้งค่า Wi-Fi"; delete op.enrollmentError;
    this.audit("HARDWARE_FLASH_ENROLLMENT_STARTED", actorId, { operationId: op.id, port: op.port, relayCount: op.relayCount, releaseChannel: op.releaseChannel });
    this.run(op).catch(error => {
      op.enrollmentRunning = false; op.enrollmentState = "RETRY_REQUIRED"; op.enrollmentError = error.code || "ENROLLMENT_FAILED";
      op.enrollmentMessage = error.message || "ยังไม่สามารถยืนยันกล่องใหม่ได้ กรุณาตรวจ Wi-Fi แล้วลองอีกครั้ง";
      this.audit("HARDWARE_FLASH_ENROLLMENT_FAILED", actorId, { operationId: op.id, port: op.port, relayCount: op.relayCount, releaseChannel: op.releaseChannel, errorCategory: op.enrollmentError });
    });
    return this.flasher.public(op, { revealSetupCode: false });
  }
  async run(op) {
    const discovery = this.discovery.start(op.actorId, { updateExisting: false });
    const deadline = this.clock() + this.discoveryTimeoutMs;
    let current = discovery;
    while (!["COMPLETED", "FAILED", "CANCELLED"].includes(current.state) && this.clock() < deadline) { await this.wait(250); current = this.discovery.get(discovery.id); }
    if (current.state !== "COMPLETED") throw Object.assign(Error("ค้นหากล่องไม่สำเร็จภายในเวลาที่กำหนด สามารถลองใหม่ได้โดยไม่ Flash ซ้ำ"), { code: "ENROLLMENT_DISCOVERY_TIMEOUT" });
    const results = current.results || [];
    if (!results.length) throw Object.assign(Error("ยังไม่พบกล่องใหม่ กรุณาตรวจว่า Portal เชื่อม Wi-Fi สำเร็จแล้ว"), { code: "ENROLLMENT_DEVICE_NOT_FOUND" });
    op.enrollmentState = "VERIFYING"; op.enrollmentMessage = "พบอุปกรณ์และกำลังตรวจ nonce/HMAC";
    const verifiedCandidates = [], errors = [];
    for (const found of results) {
      const candidate = { ipAddress: found.ipAddress, port: Number(found.port || 80), apiKey: op.pendingEnrollment.deviceKey, relayCount: Number(found.relayCount) };
      try {
        const proof = await this.driver.verifyDevice(candidate);
        if (proof.deviceId !== found.deviceId) throw Object.assign(Error("Device ID จาก challenge ไม่ตรงกับ discovery"), { code: "DEVICE_ID_MISMATCH" });
        const probe = await this.driver.probe(candidate), identity = probe.identity, config = probe.config;
        if (identity.deviceId !== proof.deviceId) throw Object.assign(Error("Device ID จากอุปกรณ์ไม่ตรงกัน"), { code: "DEVICE_ID_MISMATCH" });
        verifiedCandidates.push({ ...found, deviceId: proof.deviceId, firmwareVersion: String(identity.firmwareVersion || found.firmwareVersion || ""), relayCount: Number(config.relayCount), apiVersion: String(identity.apiVersion || "1"), hardwareStandard: identity.hardwareStandard, relays: probe.relays?.relays || [] });
      } catch (error) { errors.push(error.code || "DEVICE_VERIFY_FAILED"); }
    }
    if (!verifiedCandidates.length) throw Object.assign(Error(errors.includes("DEVICE_ID_MISMATCH") ? "Device ID จากอุปกรณ์ไม่ตรงกับผลค้นหา" : "Device Key proof ไม่ผ่านหรืออุปกรณ์ไม่ตอบสนอง สามารถลองใหม่ได้"), { code: errors.includes("DEVICE_ID_MISMATCH") ? "DEVICE_ID_MISMATCH" : "ENROLLMENT_VERIFICATION_FAILED" });
    if (verifiedCandidates.length !== 1) throw Object.assign(Error("พบกล่องที่ยืนยันด้วยข้อมูล Enrollment เดียวกันมากกว่าหนึ่งกล่อง ระบบหยุดเพื่อความปลอดภัย"), { code: "ENROLLMENT_DEVICE_AMBIGUOUS" });
    const verified = verifiedCandidates[0];
    if (this.hardwareService.repository.list().some(device => device.deviceId === verified.deviceId)) throw Object.assign(Error("Device ID นี้มี record อยู่แล้ว ระบบจะไม่เขียนทับกล่องเดิม"), { code: "DEVICE_ID_DUPLICATE" });
    if (Number(verified.relayCount) !== Number(op.relayCount)) throw Object.assign(Error("Relay Count ไม่ตรงกับค่าที่เลือกตอน Flash"), { code: "RELAY_COUNT_MISMATCH" });
    if (verified.firmwareVersion !== op.firmwareVersion) throw Object.assign(Error("Firmware version ไม่ตรงกับแพ็กเกจที่ Flash"), { code: "FIRMWARE_VERSION_MISMATCH" });
    const internal = { ...verified, id: "pending", deviceName: `Lucky Relay ${verified.deviceId.slice(-6)}`, apiKey: op.pendingEnrollment.deviceKey, hasUniqueDeviceKey: true };
    let wizard;
    try {
      wizard = this.wizardService.resumeEnrolled(internal, verified, op.actorId);
      const device = this.hardwareService.commitFlashedEnrollment(verified, op.pendingEnrollment.deviceKey, { relayCount: op.relayCount, firmwareVersion: op.firmwareVersion }, op.actorId);
      op.enrolledDevice = { id: device.id, deviceId: device.deviceId, deviceName: device.deviceName };
    } catch (error) { if (wizard) this.wizardService.discardEnrolled(wizard.id); throw error; }
    delete op.pendingEnrollment.deviceKey; delete op.pendingEnrollment.tokenHash; delete op.pendingEnrollment.tokenExpiresAt;
    op.pendingEnrollment = undefined; op.enrollmentRunning = false; op.enrollmentState = "COMPLETED"; op.enrollmentMessage = "ยืนยันและบันทึกกล่องใหม่สำเร็จ"; op.enrollmentWizard = wizard; op.state = "COMPLETED"; op.completedAt = new Date(this.clock()).toISOString();
    clearTimeout(op.enrollmentExpiryTimer);
    const cleanup = setTimeout(() => { if (this.flasher.active?.id === op.id) this.flasher.active = null; }, 300000); cleanup.unref?.();
    this.audit("HARDWARE_FLASH_ENROLLMENT_COMPLETED", op.actorId, { operationId: op.id, deviceId: op.enrolledDevice.id, controllerDeviceId: op.enrolledDevice.deviceId, port: op.port, relayCount: op.relayCount, releaseChannel: op.releaseChannel });
  }
}

module.exports = { HardwareEnrollmentHandoffService };
