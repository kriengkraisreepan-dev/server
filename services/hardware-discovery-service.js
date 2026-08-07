const crypto = require("crypto");
const { activeIpv4Interfaces } = require("../drivers/hardware-discovery-adapters");

const STATES = Object.freeze({
  STARTING: "STARTING", CHECKING_SAVED_IP: "CHECKING_SAVED_IP",
  SEARCHING_MDNS: "SEARCHING_MDNS", SEARCHING_UDP: "SEARCHING_UDP",
  SEARCHING_SUBNET: "SEARCHING_SUBNET", VERIFYING: "VERIFYING",
  COMPLETED: "COMPLETED", CANCELLED: "CANCELLED", FAILED: "FAILED"
});

class HardwareDiscoveryService {
  constructor({
    repository, hardwareService, driver, mdns, udp,
    interfaces = activeIpv4Interfaces, enabled = () => true, log = () => {},
    now = () => Date.now(), sessionTtlMs = 5 * 60 * 1000, overallTimeoutMs = 15000,
    verificationTimeoutMs = 1500, subnetProbeTimeoutMs = 450, subnetConcurrency = 16
  }) {
    Object.assign(this, {
      repository, hardwareService, driver, mdns, udp, interfaces, enabled, log, now,
      sessionTtlMs, overallTimeoutMs, verificationTimeoutMs, subnetProbeTimeoutMs, subnetConcurrency
    });
    this.sessions = new Map();
  }
  cleanup() {
    const cutoff = this.now() - this.sessionTtlMs;
    for (const [id, session] of this.sessions) {
      if (session.updatedAtMs < cutoff && !session.running) this.sessions.delete(id);
    }
  }
  publicSession(session) {
    return {
      id: session.id, state: session.state, progressMessage: session.progressMessage,
      results: session.results, errors: session.errors, startedAt: session.startedAt,
      completedAt: session.completedAt || null, retryable: session.state === STATES.FAILED
    };
  }
  start(actorId, { updateExisting = true } = {}) {
    if (!this.enabled()) {
      const error = Error("การค้นหากล่องอัตโนมัติถูกปิดใช้งาน");
      error.code = "HARDWARE_DISCOVERY_DISABLED"; error.status = 404; throw error;
    }
    this.cleanup();
    const session = {
      id: `hwdsc-${crypto.randomUUID()}`, actorId, state: STATES.STARTING,
      progressMessage: "กำลังเริ่มค้นหากล่องควบคุม", results: [], errors: [],
      startedAt: new Date(this.now()).toISOString(), updatedAtMs: this.now(),
      running: true, controller: new AbortController(), seen: new Set()
    };
    session.updateExisting = updateExisting;
    this.sessions.set(session.id, session);
    this.log("INFO", "HARDWARE_DISCOVERY_STARTED", { sessionId: session.id, actorId });
    this.run(session).catch(error => this.fail(session, error));
    return this.publicSession(session);
  }
  get(id) {
    this.cleanup();
    const session = this.sessions.get(id);
    if (!session) {
      const error = Error("ไม่พบรายการค้นหานี้ กรุณาเริ่มค้นหาใหม่");
      error.code = "HARDWARE_DISCOVERY_NOT_FOUND"; error.status = 404; throw error;
    }
    return this.publicSession(session);
  }
  cancel(id) {
    const session = this.sessions.get(id);
    if (!session) return { cancelled: true };
    session.controller.abort();
    session.state = STATES.CANCELLED;
    session.progressMessage = "ยกเลิกการค้นหาแล้ว";
    session.running = false; session.updatedAtMs = this.now();
    session.completedAt = new Date(this.now()).toISOString();
    this.log("INFO", "HARDWARE_DISCOVERY_CANCELLED", { sessionId: id });
    return this.publicSession(session);
  }
  setState(session, state, progressMessage) {
    if (session.controller.signal.aborted) return false;
    session.state = state; session.progressMessage = progressMessage; session.updatedAtMs = this.now();
    return true;
  }
  async run(session) {
    const timeout = setTimeout(() => { session.timedOut = true; session.controller.abort(); }, this.overallTimeoutMs);
    timeout.unref?.();
    try {
      const saved = this.repository.list().map(device => ({
        ipAddress: device.ipAddress, port: device.port || 80, method: "SAVED_IP",
        expectedDeviceId: device.deviceId, savedRecordId: device.id
      }));
      this.setState(session, STATES.CHECKING_SAVED_IP, "กำลังตรวจสอบกล่องที่เคยบันทึกไว้");
      await this.verifyCandidates(session, saved);

      this.setState(session, STATES.SEARCHING_MDNS, "กำลังค้นหาในเครือข่าย");
      const mdns = await this.mdns.discover({ timeoutMs: 1500, signal: session.controller.signal });
      await this.verifyCandidates(session, mdns.map(item => ({ ...item, method: "MDNS" })));

      this.setState(session, STATES.SEARCHING_UDP, "กำลังค้นหากล่องควบคุมในเครือข่าย");
      for (let attempt = 0; attempt < 2 && !session.controller.signal.aborted; attempt += 1) {
        const udp = await this.udp.discover({ timeoutMs: 1500, signal: session.controller.signal });
        await this.verifyCandidates(session, udp.map(item => ({ ...item, method: "UDP", expectedDeviceId: item.deviceId })));
      }

      if (!session.results.length && !session.controller.signal.aborted) {
        this.setState(session, STATES.SEARCHING_SUBNET, "กำลังตรวจสอบอุปกรณ์ในเครือข่าย");
        await this.scanSubnet(session);
      }
      if (session.controller.signal.aborted) {
        if (session.timedOut) throw Object.assign(Error("Discovery timeout"), { code: "DISCOVERY_TIMEOUT" });
        return this.cancel(session.id);
      }
      session.state = STATES.COMPLETED;
      session.progressMessage = session.results.length ? `พบกล่องควบคุม ${session.results.length} กล่อง` : "ยังไม่พบกล่องควบคุม";
      session.completedAt = new Date(this.now()).toISOString();
      session.running = false; session.updatedAtMs = this.now();
      this.log("INFO", "HARDWARE_DISCOVERY_COMPLETED", { sessionId: session.id, resultCount: session.results.length });
    } finally { clearTimeout(timeout); }
  }
  async verifyCandidates(session, candidates) {
    for (const candidate of candidates || []) {
      if (session.controller.signal.aborted) return;
      const key = `${candidate.ipAddress}:${candidate.port || 80}`;
      if (session.seen.has(key)) continue;
      session.seen.add(key);
      this.setState(session, STATES.VERIFYING, "กำลังตรวจสอบอุปกรณ์ที่พบ");
      try {
        const verified = await this.verify(candidate, session.controller.signal);
        if (candidate.expectedDeviceId &&
            verified.deviceId !== candidate.expectedDeviceId &&
            verified.previousDeviceId !== candidate.expectedDeviceId) continue;
        this.accept(session, verified, candidate);
      } catch (error) {
        session.errors.push({ method: candidate.method, code: error.code || "DEVICE_NOT_VERIFIED" });
        if (session.errors.length > 20) session.errors.shift();
      }
    }
  }
  async verify(candidate, signal) {
    const device = { ipAddress: candidate.ipAddress, port: Number(candidate.port || 80), apiKey: "", relayCount: 8 };
    const probe = await this.driver.probe(device, { signal, timeoutMs: this.verificationTimeoutMs });
    const { health, identity, config, relays } = probe;
    if (![health, identity, config, relays].every(value => value?.success === true)) throw Object.assign(Error("Invalid response"), { code: "INVALID_DEVICE_RESPONSE" });
    if (!identity.deviceId || (health.deviceId && health.deviceId !== identity.deviceId)) throw Object.assign(Error("Device ID mismatch"), { code: "DEVICE_ID_MISMATCH" });
    if (String(identity.apiVersion) !== "1" || identity.hardwareStandard !== "LHS-1.0") throw Object.assign(Error("Unsupported controller"), { code: "UNSUPPORTED_DEVICE" });
    const counts = [health.relayCount, identity.relayCount, config.relayCount, relays.relayCount].map(Number);
    if (new Set(counts).size !== 1 || ![2, 4, 8].includes(counts[0]) || !Array.isArray(relays.relays) || relays.relays.length !== counts[0]) {
      throw Object.assign(Error("Relay count mismatch"), { code: "RELAY_COUNT_MISMATCH" });
    }
    if (health.wifiConnected === false) throw Object.assign(Error("Wi-Fi disconnected"), { code: "WIFI_DISCONNECTED" });
    return {
      deviceId: String(identity.deviceId), previousDeviceId: identity.previousDeviceId || health.previousDeviceId || candidate.previousDeviceId || null,
      identityMigrationVersion: Number(identity.identityMigrationVersion ?? health.identityMigrationVersion ?? candidate.identityMigrationVersion ?? 0),
      deviceName: String(identity.deviceName || health.deviceName || "Lucky Relay Controller"),
      ipAddress: device.ipAddress, port: device.port, firmwareVersion: String(identity.firmwareVersion || ""),
      apiVersion: "1", hardwareStandard: identity.hardwareStandard, relayCount: counts[0],
      health: { uptimeSeconds: health.uptimeSeconds, rssi: health.rssi, freeHeapBytes: health.freeHeapBytes }
    };
  }
  accept(session, verified, candidate) {
    const duplicate = session.results.find(item => item.deviceId === verified.deviceId);
    if (duplicate) return;
    const existing = this.repository.list().find(device => device.deviceId === verified.deviceId);
    let legacyMigration = null;
    if (!existing && verified.previousDeviceId) {
      const legacy = this.repository.list().filter(device =>
        device.deviceId === verified.previousDeviceId
      );
      if (legacy.length === 1 && verified.identityMigrationVersion === 1) {
        legacyMigration = { previousDeviceId: verified.previousDeviceId, existingDeviceId: legacy[0].id, existingDeviceName: legacy[0].deviceName, requiresUserConfirmation: true };
      } else if (legacy.length > 1) {
        legacyMigration = { previousDeviceId: verified.previousDeviceId, ambiguous: true, requiresUserConfirmation: true };
      }
    }
    const previousIpAddress = existing?.ipAddress;
    if (existing && session.updateExisting) {
      this.hardwareService.updateDiscoveredLocation(existing.id, verified, candidate.method, {
        migrateIdentity: false, actorId: session.actorId
      });
    }
    session.results.push({
      ...verified, method: candidate.method, existingDeviceId: existing?.id || null,
      existingDevice: Boolean(existing), identityMigrated: false, legacyMigration,
      ipChanged: Boolean(existing && previousIpAddress !== verified.ipAddress),
      verificationStatus: "VERIFIED"
    });
  }
  async scanSubnet(session) {
    const hosts = [];
    for (const network of this.interfaces()) {
      const prefix = network.address.split(".").slice(0, 3).join(".");
      for (let value = 1; value < 255; value += 1) {
        const ipAddress = `${prefix}.${value}`;
        if (ipAddress !== network.address) hosts.push(ipAddress);
      }
    }
    const unique = [...new Set(hosts)].slice(0, 512);
    let cursor = 0;
    const worker = async () => {
      while (cursor < unique.length && !session.controller.signal.aborted) {
        const ipAddress = unique[cursor++];
        const key = `${ipAddress}:80`;
        if (session.seen.has(key)) continue;
        try {
          const identity = await this.driver.request(
            { ipAddress, port: 80, apiKey: "" }, "/api/v1/device",
            { signal: session.controller.signal, timeoutMs: this.subnetProbeTimeoutMs }
          );
          if (identity?.success && identity.deviceId) await this.verifyCandidates(session, [{ ipAddress, port: 80, method: "SUBNET" }]);
        } catch {}
      }
    };
    await Promise.all(Array.from({ length: this.subnetConcurrency }, worker));
  }
  fail(session, error) {
    if (session.controller.signal.aborted && !session.timedOut) return this.cancel(session.id);
    session.state = STATES.FAILED; session.progressMessage = "ค้นหากล่องควบคุมไม่สำเร็จ กรุณาลองใหม่";
    session.errors.push({ code: error.code || "DISCOVERY_FAILED" });
    session.running = false; session.updatedAtMs = this.now();
    session.completedAt = new Date(this.now()).toISOString();
    this.log("ERROR", "HARDWARE_DISCOVERY_FAILED", { sessionId: session.id, errorCode: error.code || "DISCOVERY_FAILED" });
  }
}

module.exports = { HardwareDiscoveryService, STATES };
