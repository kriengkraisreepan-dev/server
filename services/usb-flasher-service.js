const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { FlasherError } = require("./firmware-package-service");

const PORT_RE = /^COM(?:[1-9]|[1-9][0-9]{1,2})$/i;
class UsbFlasherService {
  constructor({ packageService, portProvider, relaySafe, recoveryTransport, log = () => {}, spawnProcess = spawn, nvsGenerator, clock = () => Date.now(), randomBytes = crypto.randomBytes, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    Object.assign(this, { packageService, portProvider, relaySafe, recoveryTransport, log, spawnProcess, nvsGenerator, clock, randomBytes, wait });
    this.tokens = new Map(); this.csrf = new Map(); this.active = null;
  }
  ports() { return this.portProvider.list().map(item => ({ ...item, hint: /^(10C4:EA60|1A86:(7523|5523))$/i.test(`${item.vid}:${item.pid}`) })); }
  issueCsrf(actorId) { const token=this.randomBytes(32).toString("base64url"); this.csrf.set(actorId,{hash:crypto.createHash("sha256").update(token).digest("hex"),expiresAt:this.clock()+600000}); return {csrfToken:token,expiresInSeconds:600}; }
  verifyCsrf(actorId, token) { const record=this.csrf.get(actorId),hash=crypto.createHash("sha256").update(String(token||"")).digest("hex"); if(!record||record.expiresAt<this.clock()||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(record.hash))) throw new FlasherError("CSRF_INVALID","คำขอความปลอดภัยหมดอายุ",403); }
  issueToken(actorId, csrfToken) { this.verifyCsrf(actorId,csrfToken); const token = this.randomBytes(32).toString("base64url"); this.tokens.set(crypto.createHash("sha256").update(token).digest("hex"), { actorId, expiresAt: this.clock() + 120000 }); return { operationToken: token, expiresInSeconds: 120 }; }
  consumeToken(token, actorId) { const key = crypto.createHash("sha256").update(String(token || "")).digest("hex"), record = this.tokens.get(key); this.tokens.delete(key); if (!record || record.actorId !== actorId || record.expiresAt < this.clock()) throw new FlasherError("OPERATION_TOKEN_INVALID", "สิทธิ์เริ่ม Flash หมดอายุหรือถูกใช้แล้ว", 403); }
  run(tool, args, onLine = () => {}) {
    return new Promise((resolve, reject) => { const child = this.spawnProcess(tool, args, { shell: false, windowsHide: true }); let output = ""; const take = chunk => { output = `${output}${chunk}`.slice(-65536); String(chunk).split(/\r?\n/).filter(Boolean).forEach(onLine); }; child.stdout?.on("data", take); child.stderr?.on("data", take); child.on("error", () => reject(new FlasherError("FLASH_TOOL_START_FAILED", "ไม่สามารถเปิดเครื่องมือ Flash ได้", 503))); child.on("close", code => code === 0 ? resolve(output) : reject(Object.assign(new FlasherError("FLASH_TOOL_FAILED", "เครื่องมือ Flash รายงานข้อผิดพลาด", 409), { exitCode: code }))); });
  }
  async inspect(port, verifiedPackage) {
    if (!PORT_RE.test(port || "")) throw new FlasherError("COM_PORT_INVALID", "COM Port ไม่ถูกต้อง", 400);
    const common = ["--chip", "esp32", "--port", port];
    const chip = await this.run(verifiedPackage.esptool, [...common, "chip_id"]);
    if (!/Chip (?:is|type:\s*)\s*ESP32\b/i.test(chip) || /ESP32-(?:S2|S3|C3|C6)/i.test(chip)) throw new FlasherError("UNSUPPORTED_CHIP", "รองรับเฉพาะ classic ESP32", 409);
    const flash = await this.run(verifiedPackage.esptool, [...common, "flash_id"]);
    if (!/(?:Detected flash size|flash size:)\s*4MB/i.test(flash)) throw new FlasherError("UNSUPPORTED_FLASH_SIZE", "รองรับเฉพาะ Flash 4 MB", 409);
  }
  async verifyRuntime(op) {
    let identity;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        identity = this.recoveryTransport.request(op.port, { command: "IDENTIFY" });
        if (identity?.ok) break;
      } catch {}
      await this.wait(1000);
    }
    if (!identity?.ok) throw new FlasherError("POST_FLASH_IDENTITY_FAILED", "ไม่สามารถตรวจสอบอุปกรณ์หลัง Flash ได้", 409);
    if (identity.firmwareVersion !== op.firmwareVersion || !identity.deviceId || ![2, 4, 8].includes(Number(identity.relayCount))) {
      throw new FlasherError("POST_FLASH_VERIFICATION_FAILED", "Firmware, Device ID หรือ Relay Count หลัง Flash ไม่ถูกต้อง", 409);
    }
    const safety = this.recoveryTransport.request(op.port, { command: "GET_RELAY_SAFETY" });
    if (!safety?.ok || !safety.safe || (safety.activeChannels || []).length) {
      throw new FlasherError("POST_FLASH_RELAY_NOT_OFF", "Relay หลัง Flash ไม่ได้อยู่สถานะ OFF ทุกช่อง", 409);
    }
    op.deviceId = identity.deviceId;
    op.relayCount = Number(identity.relayCount);
    op.apiVersion = identity.apiVersion;
    op.postFlashVerification = "PASSED";
  }
  async recoverExistingUpdate(op, pkg) {
    const app = pkg.files.application;
    if (!app || String(app.offset).toLowerCase() !== "0x10000") throw new FlasherError("UPDATE_LAYOUT_INVALID", "Update package ต้องมี application ที่ 0x10000 เท่านั้น", 500);
    op.state = "VERIFYING_EXISTING_FLASH";
    op.progress = 55;
    op.cancellable = false;
    await this.run(pkg.esptool, ["--chip", "esp32", "--port", op.port, "verify_flash", "0x10000", app.path]);
    await this.verifyRuntime(op);
    op.state = "COMPLETED";
    op.progress = 100;
    op.nvsPreservation = "SEMANTIC_REAUTHENTICATION_REQUIRED";
    op.credentialVerification = "PENDING_USB_ACCEPTANCE";
    op.message = "ยืนยัน Firmware และ Relay แล้วโดยไม่ Flash ซ้ำ กรุณาตรวจ Device Key, Setup Code และ Wi-Fi ผ่านขั้นตอน USB Acceptance ต่อ";
    op.completedAt = new Date().toISOString();
    this.log("FLASH_RECOVERY_VERIFIED", { operationId: op.id, port: op.port, firmwareVersion: op.firmwareVersion, deviceId: op.deviceId, relayCount: op.relayCount, nvsPreservation: op.nvsPreservation });
  }
  async start({ mode = "update", port, operationToken, destructiveConfirmation, relayCount }, actorId) {
    if (this.active) throw new FlasherError("FLASH_OPERATION_BUSY", "มีการ Flash กล่องอื่นอยู่", 409);
    this.consumeToken(operationToken, actorId);
    if (!PORT_RE.test(port || "")) throw new FlasherError("COM_PORT_INVALID", "COM Port ไม่ถูกต้อง", 400);
    if (!await this.relaySafe()) throw new FlasherError("RELAY_SAFE_STATE_CONFLICT", "กรุณาปิด Relay ทุกช่องผ่านขั้นตอนปกติก่อน", 409);
    if (mode === "new" && destructiveConfirmation !== "ERASE NEW DEVICE") throw new FlasherError("DESTRUCTIVE_CONFIRMATION_REQUIRED", "ต้องยืนยันการติดตั้งกล่องใหม่สองขั้น", 400);
    if(mode==="new"&&![2,4,8].includes(Number(relayCount)))throw new FlasherError("RELAY_COUNT_REQUIRED","กรุณาเลือก Relay Count 2, 4 หรือ 8",400);
    if (!["update", "new", "recover"].includes(mode)) throw new FlasherError("FLASH_MODE_INVALID", "วิธีดำเนินการไม่ถูกต้อง", 400);
    const operation = this.active = { id: crypto.randomUUID(), actorId, state: "VERIFYING_PACKAGE", mode, port, relayCount:mode==="new"?Number(relayCount):undefined, progress: 5, cancellable: true, startedAt: new Date().toISOString() };
    this.execute(operation, actorId).catch(error => { operation.state = "FAILED"; operation.error = error.code || "FLASH_FAILED"; operation.message = error.message; operation.cancellable = false; this.log("FLASH_FAILED", { operationId: operation.id, port, stage: operation.state, errorCategory: operation.error, exitCode: error.exitCode }); }).finally(() => { this.nvsGenerator?.cleanup?.(operation.id); if (operation.state !== "ENROLLMENT_PENDING") setTimeout(() => { if (this.active?.id === operation.id) this.active = null; }, 300000).unref?.(); });
    return this.public(operation);
  }
  async execute(op, actorId) {
    const pkg = this.packageService.verify(); op.firmwareVersion = pkg.manifest.firmwareVersion; op.releaseChannel = pkg.manifest.releaseChannel;
    op.state = "VALIDATING_DEVICE"; op.progress = 15; await this.inspect(op.port, pkg);
    if (!await this.relaySafe()) throw new FlasherError("RELAY_SAFE_STATE_CONFLICT", "Relay เปิดขึ้นก่อนเริ่ม Flash", 409);
    if (op.mode === "recover") {
      if (!this.recoveryTransport) throw new FlasherError("USB_RECOVERY_UNAVAILABLE", "ไม่สามารถตรวจสอบงาน Flash เดิมผ่าน USB ได้", 503);
      await this.recoverExistingUpdate(op, pkg);
      return;
    }
    let files,nvsSnapshot;
    if (op.mode === "update") {
      const app = pkg.files.application;
      if (!app || String(app.offset).toLowerCase() !== "0x10000") throw new FlasherError("UPDATE_LAYOUT_INVALID", "Update package ต้องมี application ที่ 0x10000 เท่านั้น", 500);
      files = [app];
      if(this.recoveryTransport){const directory=fs.mkdtempSync(path.join(os.tmpdir(),"lucky-update-nvs-")),before=path.join(directory,"before.bin");await this.run(pkg.esptool,["--chip","esp32","--port",op.port,"read_flash","0x9000","0x5000",before]);nvsSnapshot={directory,before,sha256:crypto.createHash("sha256").update(fs.readFileSync(before)).digest("hex")};op.nvsPreservation="SNAPSHOT_VERIFIED";}
    } else {
      const required = [["bootloader","0x1000"],["partitions","0x8000"],["application","0x10000"]];
      for (const [role, offset] of required) if (!pkg.files[role] || String(pkg.files[role].offset).toLowerCase() !== offset) throw new FlasherError("NEW_INSTALL_LAYOUT_INVALID", "New install manifest มี offset ไม่ถูกต้อง", 500);
      if (!this.nvsGenerator) throw new FlasherError("NVS_GENERATOR_UNAVAILABLE", "ยังไม่ได้ติดตั้ง NVS generator ที่อนุมัติ", 503);
      const nvs = await this.nvsGenerator.create({ generatorPath:pkg.nvsGenerator, operationId:op.id, relayCount:op.relayCount });
      op.pendingEnrollment = { deviceKey:nvs.deviceKey, setupCode:nvs.setupCode, displayOnce:true };
      files = [pkg.files.bootloader, pkg.files.partitions, { path: nvs.path, offset: "0x9000", role: "nvs" }, pkg.files.application];
    }
    if(op.mode==="new")this.nvsGenerator.verify(op.id);
    op.state = "FLASHING"; op.progress = 30; op.cancellable = false;
    const args = ["--chip","esp32","--port",op.port,"--baud","460800","--before","default_reset","--after","hard_reset","write_flash","--flash_mode","dio","--flash_freq","40m","--flash_size","4MB"];
    for (const file of files) args.push(String(file.offset), file.path);
    try{await this.run(pkg.esptool, args, line => { const match = line.match(/Writing at .*\((\d+) %\)/i); if (match) op.progress = 30 + Math.floor(Number(match[1]) * .6); });
    op.state = "VERIFYING"; op.progress = 92;
    if (op.mode === "update" && this.recoveryTransport) {
      const after = path.join(nvsSnapshot.directory, "after.bin");
      await this.run(pkg.esptool, ["--chip", "esp32", "--port", op.port, "read_flash", "0x9000", "0x5000", after]);
      const afterHash = crypto.createHash("sha256").update(fs.readFileSync(after)).digest("hex");
      const hashMatched = crypto.timingSafeEqual(Buffer.from(nvsSnapshot.sha256), Buffer.from(afterHash));
      await this.verifyRuntime(op);
      if (!hashMatched) {
        op.state = "FAILED";
        op.error = "NVS_SEMANTIC_REAUTHENTICATION_REQUIRED";
        op.progress = 100;
        op.nvsPreservation = "SEMANTIC_REAUTHENTICATION_REQUIRED";
        op.credentialVerification = "PENDING_USB_ACCEPTANCE";
        op.message = "Firmware และ Relay ผ่าน แต่ NVS มีการเปลี่ยนแปลงที่ต้องยืนยัน Device Key, Setup Code และ Wi-Fi ผ่าน USB ต่อ";
        op.completedAt = new Date().toISOString();
        this.log("FLASH_RECOVERY_REQUIRED", { operationId: op.id, port: op.port, firmwareVersion: op.firmwareVersion, deviceId: op.deviceId, relayCount: op.relayCount, nvsPreservation: op.nvsPreservation });
        return;
      }
      op.nvsPreservation = "HASH_MATCHED";
      op.mode = "update-verified";
    }
    if(op.mode==="update"&&this.recoveryTransport){const after=path.join(nvsSnapshot.directory,"after.bin");await this.run(pkg.esptool,["--chip","esp32","--port",op.port,"read_flash","0x9000","0x5000",after]);const afterHash=crypto.createHash("sha256").update(fs.readFileSync(after)).digest("hex");if(!crypto.timingSafeEqual(Buffer.from(nvsSnapshot.sha256),Buffer.from(afterHash)))throw new FlasherError("NVS_CHANGED_DURING_UPDATE","NVS เปลี่ยนแปลงระหว่างอัปเดต จึงหยุดการยืนยัน",409);let identity,lastError;for(let attempt=0;attempt<10;attempt+=1){try{identity=this.recoveryTransport.request(op.port,{command:"IDENTIFY"});if(identity?.ok)break;}catch(error){lastError=error;}await this.wait(1000);}if(!identity?.ok)throw new FlasherError("POST_FLASH_IDENTITY_FAILED","ไม่สามารถตรวจสอบอุปกรณ์หลัง Flash ได้",409);if(identity.firmwareVersion!==op.firmwareVersion||!identity.deviceId||![2,4,8].includes(Number(identity.relayCount)))throw new FlasherError("POST_FLASH_VERIFICATION_FAILED","Firmware, Device ID หรือ Relay Count หลัง Flash ไม่ถูกต้อง",409);const safety=this.recoveryTransport.request(op.port,{command:"GET_RELAY_SAFETY"});if(!safety?.ok||!safety.safe||(safety.activeChannels||[]).length)throw new FlasherError("POST_FLASH_RELAY_NOT_OFF","Relay หลัง Flash ไม่ได้อยู่สถานะ OFF ทุกช่อง",409);op.deviceId=identity.deviceId;op.relayCount=Number(identity.relayCount);op.apiVersion=identity.apiVersion;op.nvsPreservation="HASH_MATCHED";op.postFlashVerification="PASSED";}
    if (op.mode === "update-verified") op.mode = "update";
    op.state = op.mode === "new" ? "ENROLLMENT_PENDING" : "COMPLETED"; op.progress = 100; op.completedAt = new Date().toISOString();
    if (op.state === "ENROLLMENT_PENDING") {
      op.enrollmentExpiresAt = this.clock() + 30 * 60 * 1000; op.enrollmentState = "WAITING_FOR_WIFI";
      op.enrollmentMessage = "ตั้งค่า Wi-Fi ผ่าน Setup Portal แล้วกดดำเนินการตั้งค่ากล่องต่อ ห้ามปิด Server ระหว่างนี้";
      op.enrollmentExpiryTimer = setTimeout(() => { if (op.state !== "ENROLLMENT_PENDING") return; if (op.pendingEnrollment) { delete op.pendingEnrollment.deviceKey; op.pendingEnrollment = undefined; } op.state = "ENROLLMENT_RECOVERY_REQUIRED"; op.enrollmentState = "SECRET_LOST"; op.enrollmentMessage = "Enrollment หมดอายุ ข้อมูล Device Key ในหน่วยความจำถูกล้างแล้ว ต้องทำ New Install กับ Test Hardware ใหม่ด้วยตนเอง"; }, 30 * 60 * 1000);
      op.enrollmentExpiryTimer.unref?.();
    }
    this.log("FLASH_COMPLETED", { operationId: op.id, port: op.port, chipFamily: "ESP32", firmwareVersion: op.firmwareVersion, deviceId:op.deviceId, relayCount:op.relayCount, nvsPreservation:op.nvsPreservation, stage: op.state, exitCode: 0 });
    }finally{if(nvsSnapshot)fs.rmSync(nvsSnapshot.directory,{recursive:true,force:true});}
  }
  status(id, actorId) { if (!this.active || this.active.id !== id) throw new FlasherError("FLASH_OPERATION_NOT_FOUND", "ไม่พบงาน Flash", 404);if(actorId&&this.active.actorId!==actorId)throw new FlasherError("FLASH_OPERATION_OWNER_MISMATCH","Flash operation นี้เป็นของผู้ดูแลคนอื่น",403);return this.public(this.active); }
  current(actorId) { if (!this.active) throw new FlasherError("FLASH_OPERATION_NOT_FOUND", "ไม่มี Flash operation ที่กำลังทำงาน", 404);if(this.active.actorId!==actorId)throw new FlasherError("FLASH_OPERATION_OWNER_MISMATCH","Flash operation นี้เป็นของผู้ดูแลคนอื่น",403);return this.public(this.active); }
  cancel(id, actorId) { const op = this.status(id, actorId); if (!op.cancellable) throw new FlasherError("FLASH_CANCELLATION_UNSAFE", "ไม่สามารถยกเลิกระหว่างเขียน Flash", 409); this.active.state = "CANCELLED"; this.active.cancellable = false; return this.public(this.active); }
  dismiss(id, actorId) { const op=this.status(id,actorId);if(!["COMPLETED","FAILED","CANCELLED","ENROLLMENT_RECOVERY_REQUIRED"].includes(op.state))throw new FlasherError("FLASH_DISMISSAL_UNSAFE","ไม่สามารถปิดงาน Flash ที่ยังทำงานหรือรอ Enrollment อยู่",409);if(this.active?.id===id)this.active=null;return{dismissed:true}; }
  public(op, { revealSetupCode = true } = {}) { const { pendingEnrollment, actorId, enrollmentExpiryTimer, ...safe } = op;let setupCode;if(revealSetupCode&&op.state==="ENROLLMENT_PENDING"&&pendingEnrollment?.setupCode&&!pendingEnrollment.setupCodeRevealed){setupCode=pendingEnrollment.setupCode;pendingEnrollment.setupCodeRevealed=true;}return { ...safe, setupCode, displayOnce: setupCode ? true : undefined, enrollmentExpiresAt: op.enrollmentExpiresAt ? new Date(op.enrollmentExpiresAt).toISOString() : undefined }; }
}
module.exports = { UsbFlasherService, PORT_RE };
