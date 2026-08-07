const crypto = require("crypto");
const { HardwareError } = require("../drivers/relay-controller-driver");

const SETUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const terminal = state => ["COMPLETED", "FAILED"].includes(state);

class HardwareUsbAdoptionService {
  constructor({ wizardService, hardwareService, repository, driver, transport, portProvider,
    randomBytes = crypto.randomBytes, now = () => Date.now(), audit = () => {}, log = () => {} } = {}) {
    Object.assign(this, { wizardService, hardwareService, repository, driver, transport, portProvider, randomBytes, now, audit, log });
    this.tokens = new Map(); this.operations = new Map(); this.serialOwner = null;
  }
  hash(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }
  hmac(key, value) { return crypto.createHmac("sha256", key).update(value).digest("hex"); }
  command(port, payload, owner) {
    if (this.serialOwner && this.serialOwner !== owner) throw new HardwareError("USB_SERIAL_SESSION_BUSY", "COM Port กำลังถูกใช้งานโดยงานอื่น", 409);
    this.serialOwner = owner; try { return this.transport.request(port, payload); } finally { this.serialOwner = null; }
  }
  assertPort(port) {
    const normalized = String(port || "").toUpperCase();
    if (!/^COM\d+$/.test(normalized) || !this.portProvider.list().some(item => String(item.port).toUpperCase() === normalized))
      throw new HardwareError("USB_PORT_NOT_ALLOWED", "ไม่พบ COM Port ที่เลือก กรุณาเสียบ USB แล้วลองใหม่", 409);
    return normalized;
  }
  draft(id, actorId) {
    const draft = this.wizardService.get(id);
    if (draft.actorId !== actorId || draft.step !== "AUTHENTICATION" || !draft.verification) throw new HardwareError("USB_ADOPTION_DRAFT_INVALID", "งานตั้งค่านี้ไม่พร้อมสำหรับการเพิ่มกล่องผ่าน USB", 409);
    return draft;
  }
  identity(port, expected, owner) {
    let value; try { value = this.command(port, { command: "IDENTIFY" }, owner); }
    catch (error) { throw this.preflightError(error, "IDENTIFY"); }
    if (!value?.ok || !value.deviceId) throw new HardwareError("USB_IDENTIFY_FAILED", "อ่านข้อมูลกล่องผ่าน USB ไม่สำเร็จ", 409);
    if (value.deviceId !== expected.deviceId) throw new HardwareError("USB_DEVICE_ID_MISMATCH", "กล่องที่เสียบ USB ไม่ตรงกับกล่องที่ Wizard ค้นพบ", 409);
    if (String(value.firmwareVersion) !== "1.2.0" || String(value.apiVersion) !== "1") throw new HardwareError("USB_ADOPTION_VERSION_UNSUPPORTED", "กล่องต้องใช้ Firmware 1.2.0 และ API 1", 409);
    if (![2, 4, 8].includes(Number(value.relayCount)) || Number(value.relayCount) !== Number(expected.relayCount)) throw new HardwareError("RELAY_COUNT_MISMATCH", "จำนวน Relay ไม่ตรงกับข้อมูลที่ค้นพบ", 409);
    const board = String(value.boardTarget || value.boardModel || value.chip || "ESP32").toUpperCase();
    if (!board.includes("ESP32") || board.includes("S2") || board.includes("S3") || board.includes("C3")) throw new HardwareError("USB_BOARD_UNSUPPORTED", "รองรับเฉพาะบอร์ด ESP32 รุ่น Classic", 409);
    return value;
  }
  safe(port, expected, owner) {
    let value; try { value = this.command(port, { command: "GET_RELAY_SAFETY" }, owner); }
    catch (error) { throw this.preflightError(error, "GET_RELAY_SAFETY"); }
    if (!value?.ok || value.deviceId !== expected.deviceId || Number(value.relayCount) !== Number(expected.relayCount)) throw new HardwareError("USB_DEVICE_ID_MISMATCH", "ข้อมูลความปลอดภัยไม่ตรงกับกล่องที่ค้นพบ", 409);
    if (!value.safe) throw Object.assign(new HardwareError("RELAY_SAFE_STATE_CONFLICT", `กรุณาปิด Relay ช่อง ${(value.activeChannels || []).join(", ")} ผ่านขั้นตอนปกติก่อน`, 409), { activeChannels: value.activeChannels || [] });
  }
  preflightError(error, stage) {
    if (error instanceof HardwareError && !["USB_SERIAL_SESSION_BUSY"].includes(error.code)) return error;
    if (error?.code === "USB_PORT_BUSY" || error?.code === "USB_SERIAL_RESPONSE_INVALID") return new HardwareError(error.code, error.message, error.status || (error.code === "USB_PORT_BUSY" ? 409 : 502));
    if (error?.code === "USB_SERIAL_TIMEOUT") return new HardwareError(stage === "IDENTIFY" ? "USB_IDENTIFY_TIMEOUT" : "USB_RELAY_SAFETY_TIMEOUT", stage === "IDENTIFY" ? "กล่องไม่ตอบคำสั่ง IDENTIFY กรุณาตรวจ COM Port และสาย USB" : "กล่องไม่ตอบการตรวจ Relay กรุณาตรวจสาย USB แล้วลองใหม่", 504);
    if (error?.code === "USB_SERIAL_SESSION_BUSY") return new HardwareError("USB_PORT_BUSY", "COM Port กำลังถูกใช้งานโดยงานอื่น กรุณารอแล้วลองใหม่", 409);
    return new HardwareError("USB_ADOPTION_PREFLIGHT_FAILED", "ตรวจกล่องผ่าน USB ไม่สำเร็จ กรุณาตรวจ COM Port สาย USB และลองใหม่", error?.status && error.status < 500 ? error.status : 503);
  }
  assertNoRecord(deviceId) {
    const matches = this.repository.list().filter(item => item.deviceId === deviceId);
    if (matches.length > 1) throw new HardwareError("DEVICE_ID_AMBIGUOUS", "พบ Device ID ซ้ำมากกว่าหนึ่งรายการ ระบบจึงหยุดเพื่อความปลอดภัย", 409);
    if (matches.length === 1) {
      if (matches[0].credentialStatus === "REAUTHENTICATION_REQUIRED") throw new HardwareError("USB_REAUTHENTICATION_WORKFLOW_REQUIRED", "กล่องนี้มี record เดิม กรุณาใช้เมนูยืนยันกล่องเดิมผ่าน USB", 409);
      throw new HardwareError("DEVICE_ID_DUPLICATE", "กล่องนี้มีอยู่ในระบบแล้ว จึงไม่สร้าง record ใหม่", 409);
    }
  }
  issueToken(draftId, port, actorId, sessionId) {
    const started = this.now(); let stage = "DRAFT_VALIDATION", normalizedPort = String(port || "").toUpperCase(), deviceId = null;
    try {
      const draft = this.draft(draftId, actorId); stage = "COM_PORT_VALIDATION"; normalizedPort = this.assertPort(port);
      const owner = `adopt-inspect-${this.hash(`${draftId}|${actorId}`).slice(0, 16)}`; stage = "IDENTIFY";
      const identity = this.identity(normalizedPort, draft.verification, owner); deviceId = identity.deviceId; stage = "GET_RELAY_SAFETY";
      this.safe(normalizedPort, draft.verification, owner); stage = "DUPLICATE_RECORD_CHECK"; this.assertNoRecord(identity.deviceId); stage = "TOKEN_CREATION";
      const token = this.randomBytes(32).toString("base64url"), hash = this.hash(token);
      this.tokens.set(hash, { draftId, actorId, sessionHash: this.hash(sessionId), port: normalizedPort, deviceId: identity.deviceId, firmwareVersion: "1.2.0", apiVersion: "1", relayCount: Number(identity.relayCount), releaseChannel: "internal-test", expiresAt: this.now() + 120000 });
      this.log("INFO", "USB_ADOPTION_PREFLIGHT_COMPLETED", { route: "/api/hardware/setup/:draftId/usb-adoption/token", errorCode: null, preflightStage: stage, durationMs: Math.max(0, this.now() - started), port: normalizedPort, deviceId });
      return { adoptionToken: token, expiresInSeconds: 120 };
    } catch (rawError) {
      const error = ["IDENTIFY", "GET_RELAY_SAFETY"].includes(stage) ? this.preflightError(rawError, stage) : rawError instanceof HardwareError ? rawError : this.preflightError(rawError, stage);
      this.log("ERROR", "USB_ADOPTION_PREFLIGHT_FAILED", { route: "/api/hardware/setup/:draftId/usb-adoption/token", errorCode: error.code || "USB_ADOPTION_PREFLIGHT_FAILED", preflightStage: stage, durationMs: Math.max(0, this.now() - started), port: normalizedPort, ...(deviceId ? { deviceId } : {}) });
      throw error;
    }
  }
  consume(token, draftId, actorId, sessionId, port) {
    const hash = this.hash(token), binding = this.tokens.get(hash); this.tokens.delete(hash);
    if (!binding || binding.expiresAt < this.now() || binding.draftId !== draftId || binding.actorId !== actorId || binding.sessionHash !== this.hash(sessionId) || binding.port !== port)
      throw new HardwareError("USB_ADOPTION_TOKEN_INVALID", "สิทธิ์เพิ่มกล่องผ่าน USB หมดอายุหรือถูกใช้แล้ว กรุณาตรวจใหม่", 403);
    return binding;
  }
  normalizeSetupCode(value) {
    const code = String(value || "").replaceAll("-", "").toUpperCase();
    if (code.length !== 12 || [...code].some(ch => !SETUP_ALPHABET.includes(ch))) throw new HardwareError("SETUP_CODE_INVALID", "Setup Code ไม่ถูกต้อง กรุณาตรวจรหัสบนกล่อง", 409);
    return code.replace(/(.{4})(?=.)/g, "$1-");
  }
  public(op) {
    const { newKey, setupCode, sessionHash, transitionId, deviceId, draftId, ...safe } = op;
    return safe;
  }
  async start(draftId, body, actorId, sessionId) {
    const allowed = ["adoptionToken", "port", "setupCode", "deviceName", "location", "confirmedSafe"];
    if (Object.keys(body || {}).some(key => !allowed.includes(key))) throw new HardwareError("USB_ADOPTION_REQUEST_REJECTED", "คำขอมีข้อมูลที่ Browser ไม่ได้รับอนุญาตให้ส่ง", 400);
    const port = this.assertPort(body.port), binding = this.consume(body.adoptionToken, draftId, actorId, sessionId, port), draft = this.draft(draftId, actorId);
    if (body.confirmedSafe !== true) throw new HardwareError("USB_SAFE_CONFIRMATION_REQUIRED", "กรุณายืนยันว่าถอดโหลดไฟบ้านและ Relay ทุกช่อง OFF", 409);
    const deviceName = String(body.deviceName || "").trim(), location = String(body.location || "").trim();
    if (!deviceName || deviceName.length > 80 || location.length > 120) throw new HardwareError("USB_ADOPTION_METADATA_INVALID", "กรุณาตรวจชื่อกล่องและตำแหน่ง", 400);
    const setupCode = this.normalizeSetupCode(body.setupCode), id = `usbadopt-${crypto.randomUUID()}`;
    this.identity(port, draft.verification, id); this.safe(port, draft.verification, id); this.assertNoRecord(binding.deviceId);
    const op = { id, actorId, sessionHash: this.hash(sessionId), draftId, port, deviceId: binding.deviceId, relayCount: binding.relayCount, firmwareVersion: binding.firmwareVersion, apiVersion: binding.apiVersion, releaseChannel: binding.releaseChannel, deviceName, location, state: "STAGING_KEY", transitionId: this.randomBytes(16).toString("hex"), newKey: this.randomBytes(32).toString("base64url"), setupCode, retryCount: 0, startedAt: new Date(this.now()).toISOString(), expiresAt: this.now() + 600000 };
    this.operations.set(id, op); let staged = false, committed = false;
    try {
      let response = this.command(port, { command: "STAGE_DEVICE_KEY", transitionId: op.transitionId, setupCode: op.setupCode, deviceKey: op.newKey }, id);
      if (!response?.ok) throw new HardwareError(response?.error || "KEY_STAGE_FAILED", "Firmware ปฏิเสธการเริ่มเปลี่ยน Device Key", 409); staged = true; op.state = "VERIFYING_KEY";
      const nonce = this.randomBytes(32).toString("hex"); response = this.command(port, { command: "VERIFY_DEVICE_KEY", transitionId: op.transitionId, nonce }, id);
      this.identityResponse(response, op); const expected = this.hmac(op.newKey, `${nonce}|${op.deviceId}|${op.relayCount}|${op.transitionId}`);
      if (typeof response.proof !== "string" || response.proof.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(response.proof), Buffer.from(expected))) throw new HardwareError("DEVICE_KEY_PROOF_INVALID", "Firmware ยืนยัน Device Key ใหม่ไม่สำเร็จ", 409);
      this.safe(port, draft.verification, id); op.state = "COMMITTING_KEY";
      const commitNonce = this.randomBytes(32).toString("hex"), proof = this.hmac(op.newKey, `commit|${commitNonce}|${op.transitionId}`);
      response = this.command(port, { command: "COMMIT_DEVICE_KEY", transitionId: op.transitionId, nonce: commitNonce, proof }, id);
      if (!response?.ok) throw new HardwareError("DEVICE_KEY_COMMIT_FAILED", "Firmware ไม่สามารถ commit Device Key ใหม่ได้", 409); committed = true;
      await this.verifyAndSave(op, draft); return this.public(op);
    } catch (error) {
      if (staged && !committed) try { this.command(port, { command: "ROLLBACK_DEVICE_KEY", transitionId: op.transitionId }, id); } catch {}
      if (committed && op.newKey) { op.state = "VAULT_RECOVERY_REQUIRED"; op.errorCode = "VAULT_COMMIT_FAILED"; op.message = "Firmware เปลี่ยนรหัสแล้ว แต่ยังบันทึก DPAPI vault ไม่สำเร็จ กรุณาอย่าปิดโปรแกรมหรือถอด USB แล้วกด Retry"; }
      else { op.state = "FAILED"; op.errorCode = error.code || "USB_ADOPTION_FAILED"; op.message = error.code ? error.message : "เพิ่มกล่องผ่าน USB ไม่สำเร็จ กรุณาตรวจสาย USB แล้วลองใหม่"; op.newKey = ""; }
      return this.public(op);
    } finally { op.setupCode = ""; }
  }
  identityResponse(response, op) {
    if (!response?.ok || response.deviceId !== op.deviceId || Number(response.relayCount) !== Number(op.relayCount) || response.transitionId && response.transitionId !== op.transitionId) throw new HardwareError("USB_DEVICE_ID_MISMATCH", "Firmware ตอบข้อมูล transition ไม่ตรงกัน", 409);
  }
  async verifyAndSave(op, draft) {
    const verified = await this.driver.verifyDevice({ ...draft.candidate, apiKey: op.newKey, relayCount: op.relayCount });
    if (!verified?.success || verified.verified !== true || verified.deviceId !== op.deviceId || Number(verified.relayCount) !== op.relayCount || String(verified.firmwareVersion) !== "1.2.0" || String(verified.apiVersion) !== "1") throw new HardwareError("DEVICE_KEY_READBACK_FAILED", "ตรวจ Device Key และข้อมูล Firmware ใหม่ผ่านเครือข่ายไม่สำเร็จ", 503);
    const device = this.hardwareService.commitUsbAdoption({ ...draft.verification, ipAddress: draft.candidate.ipAddress, port: draft.candidate.port }, op.newKey, { deviceName: op.deviceName, location: op.location }, op.actorId);
    this.wizardService.completeUsbAdoption(op.draftId, this.repository.findById(device.id), draft.verification);
    op.state = "COMPLETED"; op.completedAt = new Date(this.now()).toISOString(); op.newKey = "";
    this.audit("HARDWARE_USB_ADOPTION_COMPLETED", op.actorId, { deviceRecordId: device.id, controllerDeviceId: op.deviceId, relayCount: op.relayCount });
  }
  get(id, actorId, sessionId) {
    const op = this.operations.get(id); if (!op) throw new HardwareError("USB_ADOPTION_NOT_FOUND", "ไม่พบงานเพิ่มกล่องผ่าน USB งานอาจหายหลัง Server restart", 404);
    if (op.actorId !== actorId || op.sessionHash !== this.hash(sessionId)) throw new HardwareError("USB_ADOPTION_OWNER_MISMATCH", "งานนี้เป็นของผู้ดูแลหรือ session อื่น", 403);
    return this.public(op);
  }
  async retry(id, actorId, sessionId) {
    const op = this.operations.get(id); this.get(id, actorId, sessionId);
    if (op.state !== "VAULT_RECOVERY_REQUIRED" || !op.newKey || op.retryCount >= 3 || op.expiresAt < this.now()) throw new HardwareError("VAULT_RECOVERY_NOT_AVAILABLE", "ไม่มีงาน vault ที่พร้อม Retry งานหมดอายุ หรือครบจำนวนครั้งแล้ว", 409);
    op.retryCount++; const draft = this.draft(op.draftId, actorId);
    try { this.identity(op.port, draft.verification, op.id); this.safe(op.port, draft.verification, op.id); this.assertNoRecord(op.deviceId); await this.verifyAndSave(op, draft); }
    catch (error) { op.state = "VAULT_RECOVERY_REQUIRED"; op.errorCode = error.code || "VAULT_COMMIT_FAILED"; op.message = "ยังบันทึก DPAPI vault ไม่สำเร็จ กรุณาอย่าปิดโปรแกรมหรือถอด USB"; }
    return this.public(op);
  }
}

module.exports = { HardwareUsbAdoptionService };
