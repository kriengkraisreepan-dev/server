const { DEVICE_TYPES, DEVICE_STATUS, SUPPORTED_RELAY_COUNTS } = require("../domain/hardware-device");
const { HardwareError } = require("../drivers/relay-controller-driver");
const crypto = require("crypto");

class HardwareService {
  constructor(repository, driver, { tables, saveTables, audit = () => {} } = {}) {
    Object.assign(this, { repository, driver, tables, saveTables, audit });
  }
  publicDevice(device) {
    if (!device) return null;
    const { apiKey, secretId, ...safe } = device;
    return { ...safe, apiKeyMasked: apiKey ? "••••••••" : "", hasApiKey: Boolean(apiKey) };
  }
  list() { return this.repository.list().map(device => this.publicDevice(device)); }
  auditWiringReverify(device, actorId = "SYSTEM") {
    if (!device?.wiringProfile?.reverifyEventPending) return;
    this.audit("WIRING_ASSISTANT_REVERIFY_REQUIRED", actorId, { deviceId: device.id, controllerDeviceId: device.deviceId, reasons: device.wiringProfile.reverifyReasons || [] });
    this.repository.update(device.id, { wiringProfile: { ...device.wiringProfile, reverifyEventPending: false } });
  }
  getRequired(id) {
    const device = this.repository.findById(id);
    if (!device) throw new HardwareError("HARDWARE_DEVICE_NOT_FOUND", "ไม่พบอุปกรณ์", 404);
    return device;
  }
  getAuthenticated(id) {
    const device = this.getRequired(id);
    if (!device.apiKey || device.credentialStatus === "REAUTHENTICATION_REQUIRED") throw new HardwareError("HARDWARE_REAUTHENTICATION_REQUIRED", "ต้องยืนยันอุปกรณ์อีกครั้งก่อนใช้งาน", 409);
    return device;
  }
  // The physical device itself rejected the API Key (firmware returned 401), meaning the
  // stored key no longer matches what is flashed on the ESP32. Flag the record so the UI's
  // existing USB recovery modal switches to the Device Key rotation flow (see
  // public/js/app.js openUsbRecovery / services/hardware-usb-recovery-service.js
  // startKeyRotation) instead of silently retrying a key that will never work.
  markAuthFailure(id, error) {
    if (error?.code !== "DEVICE_AUTH_FAILED") return false;
    this.repository.update(id, { credentialStatus: "REAUTHENTICATION_REQUIRED", status: DEVICE_STATUS.OFFLINE, lastErrorCode: error.code, updatedAt: new Date().toISOString() });
    this.audit("HARDWARE_CREDENTIAL_REAUTHENTICATION_REQUIRED", "SYSTEM", { deviceId: id });
    return true;
  }
  input(data, existing = null) {
    const deviceName = String(data.deviceName ?? existing?.deviceName ?? "").trim();
    const ipAddress = String(data.ipAddress ?? existing?.ipAddress ?? "").trim();
    const port = Number(data.port ?? existing?.port ?? 80);
    const apiKey = String(data.apiKey || existing?.apiKey || "").trim();
    const deviceType = data.deviceType || existing?.deviceType || DEVICE_TYPES.RELAY_CONTROLLER;
    if (!deviceName) throw new HardwareError("DEVICE_NAME_REQUIRED", "กรุณาระบุชื่ออุปกรณ์");
    if (deviceType !== DEVICE_TYPES.RELAY_CONTROLLER) throw new HardwareError("INVALID_DEVICE_TYPE", "ประเภทอุปกรณ์ไม่รองรับ");
    if (!apiKey) throw new HardwareError("API_KEY_REQUIRED", "กรุณาระบุ API Key");
    this.driver.endpoint({ ipAddress, port });
    return { deviceName, ipAddress, port, apiKey, deviceType };
  }
  probeFields(probe) {
    const identity = probe.identity, health = probe.health, config = probe.config;
    return {
      deviceId: identity.deviceId, relayCount: Number(config.relayCount),
      firmwareVersion: identity.firmwareVersion, apiVersion: String(identity.apiVersion),
      hardwareStandard: identity.hardwareStandard, boardModel: identity.boardModel || null,
      status: DEVICE_STATUS.ONLINE, lastSeen: new Date().toISOString(),
      health: { uptimeSeconds: health.uptimeSeconds ?? health.uptime, rssi: health.rssi, freeHeapBytes: health.freeHeapBytes }
    };
  }
  async testCandidate(data) {
    const candidate = this.input(data, data.existingDeviceId ? this.getRequired(data.existingDeviceId) : null);
    const probe = await this.driver.probe(candidate);
    return { connected: true, ...this.probeFields(probe) };
  }
  async create(data, actorId) {
    const candidate = this.input(data);
    const probe = await this.driver.probe(candidate);
    const now = new Date().toISOString();
    const device = this.repository.create({ ...candidate, ...this.probeFields(probe), createdAt: now, updatedAt: now });
    this.audit("HARDWARE_DEVICE_CREATED", actorId, { deviceId: device.id });
    return this.publicDevice(device);
  }
  commitFlashedEnrollment(verified, deviceKey, expected, actorId) {
    if (!verified?.deviceId || typeof deviceKey !== "string" || deviceKey.length < 32) throw new HardwareError("ENROLLMENT_CREDENTIAL_INVALID", "ข้อมูล Enrollment ไม่สมบูรณ์", 409);
    const matches = this.repository.list().filter(device => device.deviceId === verified.deviceId);
    if (matches.length) throw new HardwareError("DEVICE_ID_DUPLICATE", "มี Device ID นี้อยู่แล้ว ระบบจะไม่เขียนทับกล่องเดิม", 409);
    if (Number(verified.relayCount) !== Number(expected.relayCount)) throw new HardwareError("RELAY_COUNT_MISMATCH", "Relay Count ของกล่องไม่ตรงกับค่าที่เลือกตอน Flash", 409);
    if (String(verified.firmwareVersion) !== String(expected.firmwareVersion)) throw new HardwareError("FIRMWARE_VERSION_MISMATCH", "Firmware version ของกล่องไม่ตรงกับแพ็กเกจที่ Flash", 409);
    const now = new Date().toISOString();
    const device = this.repository.create({
      deviceName: `Lucky Relay ${String(verified.deviceId).slice(-6)}`,
      deviceId: verified.deviceId, ipAddress: verified.ipAddress, port: Number(verified.port || 80),
      apiKey: deviceKey, hasUniqueDeviceKey: true, deviceType: DEVICE_TYPES.RELAY_CONTROLLER,
      relayCount: Number(verified.relayCount), firmwareVersion: verified.firmwareVersion,
      apiVersion: String(verified.apiVersion || "1"), hardwareStandard: verified.hardwareStandard,
      status: DEVICE_STATUS.ONLINE, lastSeen: now, lastVerifiedAt: now,
      setupCompletedAt: null, verificationStatus: "PASSED", relayTestStatus: "PENDING",
      relayTestedChannels: [], enrollmentSource: "ONE_CLICK_NEW_INSTALL", createdAt: now, updatedAt: now
    });
    this.audit("HARDWARE_FLASH_ENROLLMENT_COMMITTED", actorId, { deviceId: device.id, controllerDeviceId: device.deviceId, relayCount: device.relayCount, firmwareVersion: device.firmwareVersion });
    return this.publicDevice(device);
  }
  commitUsbAdoption(verified, deviceKey, metadata, actorId) {
    if (!verified?.deviceId || typeof deviceKey !== "string" || Buffer.byteLength(deviceKey) < 32) throw new HardwareError("ADOPTION_CREDENTIAL_INVALID", "ข้อมูลยืนยันกล่องผ่าน USB ไม่สมบูรณ์", 409);
    if (this.repository.list().some(device => device.deviceId === verified.deviceId)) throw new HardwareError("DEVICE_ID_DUPLICATE", "Device ID นี้มีอยู่แล้ว ระบบจะไม่เขียนทับ record เดิม", 409);
    const now = new Date().toISOString();
    const device = this.repository.create({
      deviceName: String(metadata.deviceName).trim(), locationLabel: String(metadata.location || "").trim(),
      deviceId: verified.deviceId, ipAddress: verified.ipAddress, port: Number(verified.port || 80), apiKey: deviceKey,
      hasUniqueDeviceKey: true, credentialStatus: "AUTHENTICATED", deviceType: DEVICE_TYPES.RELAY_CONTROLLER,
      relayCount: Number(verified.relayCount), firmwareVersion: String(verified.firmwareVersion), apiVersion: String(verified.apiVersion),
      hardwareStandard: verified.hardwareStandard, boardModel: verified.boardModel || null, status: DEVICE_STATUS.ONLINE,
      lastSeen: now, lastVerifiedAt: now, setupCompletedAt: null, verificationStatus: "PASSED", relayTestStatus: "PENDING",
      relayTestedChannels: [], enrollmentSource: "EXISTING_USB_ADOPTION", createdAt: now, updatedAt: now
    });
    this.audit("HARDWARE_USB_ADOPTION_RECORD_COMMITTED", actorId, { deviceId: device.id, controllerDeviceId: device.deviceId });
    return this.publicDevice(device);
  }
  legacyMigrationCandidate(previousDeviceId, ipAddress) {
    if (!previousDeviceId) return null;
    const matches = this.repository.list().filter(device => device.deviceId === previousDeviceId);
    if (matches.length > 1) throw new HardwareError("LEGACY_IDENTITY_AMBIGUOUS", "พบข้อมูลกล่องเดิมมากกว่าหนึ่งรายการ กรุณาตรวจสอบด้วยตนเอง", 409);
    return matches.length ? { id: matches[0].id, deviceId: matches[0].deviceId, deviceName: matches[0].deviceName } : null;
  }
  saveVerifiedSetup(candidate, verification, metadata, actorId) {
    const name = String(metadata.deviceName || "").trim();
    if (!name || name.length > 80) throw new HardwareError("DEVICE_NAME_REQUIRED", "กรุณาระบุชื่อที่ใช้ในโปรแกรมไม่เกิน 80 ตัวอักษร");
    let existing = this.repository.list().find(device => device.deviceId === verification.deviceId);
    if (!existing && metadata.legacyMigrationRecordId) {
      const legacy = this.repository.findById(metadata.legacyMigrationRecordId);
      if (!legacy || legacy.deviceId !== verification.previousDeviceId ||
          verification.identityMigrationVersion !== 1 || metadata.legacyMigrationAuthorized !== true) {
        throw new HardwareError("LEGACY_MIGRATION_NOT_AUTHORIZED", "ไม่สามารถยืนยันการย้ายข้อมูลกล่องเดิมได้", 409);
      }
      existing = legacy;
    }
    const duplicateName = this.repository.list().find(device => device.id !== existing?.id && device.deviceName.toLowerCase() === name.toLowerCase() && device.deviceId !== verification.deviceId);
    if (duplicateName) throw new HardwareError("DEVICE_NAME_DUPLICATE", "มีอุปกรณ์ชื่อนี้แล้ว กรุณาใช้ชื่ออื่น", 409);
    const now = new Date().toISOString();
    const fields = {
      ...candidate, deviceName: name, locationLabel: String(metadata.locationLabel || "").trim().slice(0, 120),
      deviceId: verification.deviceId, relayCount: verification.relayCount,
      firmwareVersion: verification.firmwareVersion, apiVersion: verification.apiVersion,
      hardwareStandard: verification.hardwareStandard, boardModel: verification.boardModel || null,
      status: metadata.verificationStatus === "WARNING" ? DEVICE_STATUS.WARNING : DEVICE_STATUS.ONLINE,
      lastSeen: now, lastVerifiedAt: now, setupCompletedAt: existing?.setupCompletedAt || now,
      verificationStatus: metadata.verificationStatus, relayTestStatus: metadata.relayTestStatus,
      relayTestedChannels: metadata.relayTestedChannels || [], setupWizardVersion: 1, updatedAt: now
    };
    if (existing?.deviceId !== verification.deviceId) {
      fields.previousDeviceId = existing.deviceId;
      fields.deviceIdMigratedAt = now;
      fields.identityMigrationVersion = verification.identityMigrationVersion;
    }
    const saved = existing
      ? this.repository.update(existing.id, fields)
      : this.repository.create({ ...fields, createdAt: now });
    this.auditWiringReverify(saved, actorId);
    this.audit(existing ? "HARDWARE_WIZARD_DEVICE_UPDATED" : "HARDWARE_WIZARD_DEVICE_CREATED", actorId, { deviceId: saved.id, controllerDeviceId: saved.deviceId });
    return { device: this.publicDevice(saved), updated: Boolean(existing) };
  }
  async update(id, data, actorId) {
    const existing = this.getRequired(id), candidate = this.input(data, existing);
    const probe = await this.driver.probe(candidate);
    const device = this.repository.update(id, { ...candidate, ...this.probeFields(probe), updatedAt: new Date().toISOString() });
    this.auditWiringReverify(device, actorId);
    this.audit("HARDWARE_DEVICE_UPDATED", actorId, { deviceId: id });
    return this.publicDevice(device);
  }
  delete(id, actorId) {
    this.getRequired(id);
    if (this.tables().some(table => table.hardwareDeviceId === id)) throw new HardwareError("DEVICE_IS_MAPPED", "ไม่สามารถลบอุปกรณ์ที่ยังผูกกับโต๊ะ", 409);
    this.repository.delete(id);
    this.audit("HARDWARE_DEVICE_DELETED", actorId, { deviceId: id });
  }
  async refresh(id) {
    const device = this.getAuthenticated(id);
    try {
      const probe = await this.driver.probe(device);
      const updated = this.repository.update(id, { ...this.probeFields(probe), updatedAt: new Date().toISOString() });
      this.auditWiringReverify(updated, "SYSTEM");
      return this.publicDevice(updated);
    } catch (error) {
      this.repository.update(id, { status: DEVICE_STATUS.OFFLINE, updatedAt: new Date().toISOString() });
      throw error;
    }
  }
  updateDiscoveredLocation(id, verification, method, { migrateIdentity = false, actorId = "SYSTEM" } = {}) {
    const existing = this.getRequired(id);
    if (!verification?.deviceId) throw new HardwareError("INVALID_DEVICE_RESPONSE", "ไม่พบ Device ID ที่ตรวจสอบแล้ว", 409);
    if (!migrateIdentity && existing.deviceId !== verification.deviceId) {
      throw new HardwareError("DEVICE_ID_MISMATCH", "Device ID ไม่ตรงกับอุปกรณ์เดิม", 409);
    }
    const now = new Date().toISOString();
    const changes = {
      ipAddress: verification.ipAddress,
      port: verification.port,
      status: DEVICE_STATUS.ONLINE,
      lastSeen: now,
      lastDiscoveredAt: now,
      lastDiscoveryMethod: method,
      discoveryProtocolVersion: 1,
      firmwareVersion: verification.firmwareVersion,
      apiVersion: verification.apiVersion,
      hardwareStandard: verification.hardwareStandard,
      relayCount: verification.relayCount,
      health: verification.health,
      updatedAt: now
    };
    if (verification.mdnsHostname) changes.mdnsHostname = verification.mdnsHostname;
    if (migrateIdentity) {
      changes.previousDeviceId = existing.deviceId;
      changes.deviceId = verification.deviceId;
      changes.deviceIdMigratedAt = now;
    }
    const updated = this.repository.update(id, changes);
    this.auditWiringReverify(updated, actorId);
    this.audit(migrateIdentity ? "HARDWARE_DEVICE_ID_MIGRATED" : "HARDWARE_DEVICE_DISCOVERED", actorId, {
      deviceId: id, controllerDeviceId: verification.deviceId, discoveryMethod: method
    });
    return this.publicDevice(updated);
  }
  async health(id) {
    const device = this.getAuthenticated(id);
    try {
      const health = await this.driver.health(device);
      this.repository.update(id, { status: DEVICE_STATUS.ONLINE, lastSeen: new Date().toISOString(), health: { uptimeSeconds: health.uptimeSeconds ?? health.uptime, rssi: health.rssi, freeHeapBytes: health.freeHeapBytes } });
      return { status: DEVICE_STATUS.ONLINE, ...health };
    } catch (error) {
      this.repository.update(id, { status: DEVICE_STATUS.OFFLINE });
      throw error;
    }
  }
  relays(id) { return this.driver.relays(this.getAuthenticated(id)); }
  relayConfig(id) { return this.driver.relayConfig(this.getRequired(id)); }
  async setRelayCount(id, relayCount, actorId = "SYSTEM") {
    const device = this.getRequired(id);
    const count = Number(relayCount);
    if (!SUPPORTED_RELAY_COUNTS.includes(count)) throw new HardwareError("INVALID_RELAY_COUNT", "Relay Count ต้องเป็น 2, 4 หรือ 8");
    if (this.tables().some(table => table.hardwareDeviceId === id && Number(table.relayChannel) > count)) {
      throw new HardwareError("RELAY_COUNT_HAS_MAPPINGS", "มีโต๊ะผูกกับช่องที่เกิน Relay Count ใหม่ กรุณาแก้การผูกก่อน", 409);
    }
    const result = await this.driver.setRelayCount(device, relayCount);
    const updated = this.repository.update(id, { relayCount: count, status: DEVICE_STATUS.ONLINE, lastSeen: new Date().toISOString(), updatedAt: new Date().toISOString() });
    this.auditWiringReverify(updated, actorId);
    return result;
  }
  relayState(id, relayId, state) { return this.driver.setRelayState(this.getRequired(id), relayId, Boolean(state)).catch(error => { this.markAuthFailure(id, error); throw error; }); }
  allOff(id) { return this.driver.allOff(this.getRequired(id)).catch(error => { this.markAuthFailure(id, error); throw error; }); }
  async replaceController(oldId, newId, confirmed, actorId) {
    if (confirmed !== true) throw new HardwareError("DEVICE_REPLACEMENT_CONFIRMATION_REQUIRED", "กรุณายืนยันการเปลี่ยนกล่องควบคุม", 409);
    if (oldId === newId) throw new HardwareError("DEVICE_REPLACEMENT_INVALID", "กล่องเดิมและกล่องใหม่ต้องเป็นคนละอุปกรณ์", 409);
    const oldDevice = this.getAuthenticated(oldId), newDevice = this.getAuthenticated(newId);
    if (oldDevice.deviceId === newDevice.deviceId) throw new HardwareError("DEVICE_ID_DUPLICATE", "Device ID ของกล่องใหม่ซ้ำกับกล่องเดิม", 409);
    const mapped = this.tables().filter(table => table.hardwareDeviceId === oldId);
    const maximum = mapped.reduce((value, table) => Math.max(value, Number(table.relayChannel || 0)), 0);
    if (maximum > Number(newDevice.relayCount)) throw new HardwareError("RELAY_COUNT_MISMATCH", "Relay Count ของกล่องใหม่ไม่รองรับ mapping เดิม", 409);
    for (const device of [oldDevice, newDevice]) {
      const state = await this.driver.relays(device), active = (state.relays || []).filter(item => item.state === "ON").map(item => item.channel);
      if (active.length) throw Object.assign(new HardwareError("RELAY_SAFE_STATE_CONFLICT", `กรุณาปิด Relay ช่อง ${active.join(", ")} ผ่านขั้นตอนปกติก่อน`, 409), { activeChannels: active });
    }
    const tableBefore = structuredClone(this.tables());
    const now = new Date().toISOString();
    try {
      for (const table of mapped) table.hardwareDeviceId = newId;
      this.saveTables();
      this.repository.mutateAtomically(devices => {
        const oldRecord = devices.find(item => item.id === oldId), newRecord = devices.find(item => item.id === newId);
        Object.assign(oldRecord, { status: "REPLACED_ARCHIVED", replacementDeviceId: newId, replacedAt: now, updatedAt: now });
        Object.assign(newRecord, { status: DEVICE_STATUS.ONLINE, replacedDeviceId: oldId, replacementCommittedAt: now, updatedAt: now });
      });
    } catch (error) {
      const tables = this.tables(); tables.splice(0, tables.length, ...tableBefore); try { this.saveTables(); } catch {}
      throw error;
    }
    this.audit("HARDWARE_DEVICE_REPLACED", actorId, { oldRecordId: oldId, newRecordId: newId, mappingCount: mapped.length });
    return { oldDevice: this.publicDevice(this.getRequired(oldId)), newDevice: this.publicDevice(this.getRequired(newId)), mappingCount: mapped.length };
  }
  async enrollUniqueDeviceKey(id, actorId) {
    const device = this.getRequired(id);
    const transitionId = crypto.randomUUID();
    const newKey = crypto.randomBytes(32).toString("base64url");
    const candidate = { ...device, apiKey: newKey };
    try {
      await this.driver.stageDeviceKey(device, transitionId, newKey);
      const verified = await this.driver.verifyDevice(candidate);
      if (!verified?.verified || verified.deviceId !== device.deviceId) throw new HardwareError("DEVICE_ID_MISMATCH", "Device ID ไม่ตรงระหว่างเปลี่ยนรหัส", 409);
      await this.driver.commitDeviceKey(candidate, transitionId);
      const saved = this.repository.update(id, { apiKey: newKey, hasUniqueDeviceKey: true, deviceKeyRotatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      this.audit("HARDWARE_DEVICE_KEY_ROTATED", actorId, { deviceId: id, controllerDeviceId: device.deviceId });
      return { device: this.publicDevice(saved), enrolled: true };
    } catch (error) {
      try { await this.driver.rollbackDeviceKey(device, transitionId); } catch {}
      try { await this.driver.rollbackDeviceKey(candidate, transitionId); } catch {}
      throw error;
    }
  }
  wifiNetworks(id) { return this.driver.wifiNetworks(this.getRequired(id)); }
  restart() { throw new HardwareError("DEVICE_RESTART_UNSUPPORTED", "Firmware รุ่นนี้ยังไม่รองรับการ Restart จากระยะไกล", 409); }
  mapTable(tableId, deviceId, relayChannel, actorId) {
    const table = this.tables().find(item => String(item.id) === String(tableId));
    if (!table) throw new HardwareError("TABLE_NOT_FOUND", "ไม่พบโต๊ะ", 404);
    if (!deviceId) {
      delete table.hardwareDeviceId; delete table.relayChannel; this.saveTables();
      return this.tableHardware(table);
    }
    const device = this.getRequired(deviceId), channel = Number(relayChannel);
    if (!Number.isInteger(channel) || channel < 1 || channel > device.relayCount) throw new HardwareError("INVALID_RELAY_CHANNEL", "ช่อง Relay ไม่ถูกต้อง");
    const duplicate = this.tables().find(item => String(item.id) !== String(table.id) && item.hardwareDeviceId === deviceId && Number(item.relayChannel) === channel);
    if (duplicate) throw new HardwareError("DUPLICATE_RELAY_MAPPING", `Relay ช่องนี้ถูกใช้กับ ${duplicate.name} แล้ว`, 409);
    table.hardwareDeviceId = deviceId; table.relayChannel = channel; this.saveTables();
    this.audit("TABLE_RELAY_MAPPED", actorId, { tableId: table.id, deviceId, relayChannel: channel });
    return this.tableHardware(table);
  }
  tableHardware(table) {
    const device = table.hardwareDeviceId && this.repository.findById(table.hardwareDeviceId);
    return {
      hardwareConfigured: Boolean(device && table.relayChannel),
      hardwareDeviceId: table.hardwareDeviceId || null,
      hardwareDeviceName: device?.deviceName || null,
      relayChannel: table.relayChannel || null,
      hardwareStatus: device?.status || null,
      relayAvailable: Boolean(device && table.relayChannel && device.status === DEVICE_STATUS.ONLINE)
    };
  }
  async setTableRelay(table, state) {
    const mapping = this.tableHardware(table);
    if (!mapping.hardwareConfigured) throw new HardwareError("HARDWARE_NOT_CONFIGURED", "ยังไม่ได้ตั้งค่า Hardware", 409);
    const device = this.getRequired(table.hardwareDeviceId);
    if (device.status !== DEVICE_STATUS.ONLINE) throw new HardwareError("DEVICE_OFFLINE", "อุปกรณ์ Offline", 503);
    try {
      const result = await this.driver.setRelayState(device, table.relayChannel, state === "on");
      table.relayState = state; table.relayDesiredState = state; table.relayActualState = state; table.relayPending = false;
      return { connected: true, ...result };
    } catch (error) {
      table.relayPending = true;
      if (!this.markAuthFailure(device.id, error)) this.repository.update(device.id, { status: DEVICE_STATUS.OFFLINE });
      throw error;
    }
  }
}

module.exports = { HardwareService, DEVICE_STATUS, SUPPORTED_RELAY_COUNTS };
