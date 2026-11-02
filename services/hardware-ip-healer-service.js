// The relay controllers get their address from the router over DHCP, so a router restart or a lease
// that runs out can hand a box a new one. The saved address then goes dead and the table card says
// "อุปกรณ์ Offline" even though the box is fine. Health polling notices that; this service is what
// does something about it — it runs the same discovery a person would press a button for, but on
// its own, and the discovery service repoints the saved record when the SAME deviceId turns up at a
// new address (it never changes which table a relay belongs to, and never sends the Device Key to
// the candidate — discovery only makes the public GET probes).
const BACKOFF_MS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000];

class HardwareIpHealerService {
  // `afterHeal(recordId)` re-checks health right away so the relays are reconciled (lights back on)
  // without waiting for the next 60-second poll.
  constructor({ discovery, repository, audit = () => {}, log = () => {}, now = () => Date.now(), afterHeal = null, enabled = () => true, scanTimeoutMs = 45000 } = {}) {
    Object.assign(this, { discovery, repository, audit, log, now, afterHeal, enabled, scanTimeoutMs });
    this.running = null;
    this.state = new Map(); // record id -> { attempts, nextAttemptAt, reportedMissing }
  }

  // Fire-and-forget entry point for the health monitor. Never throws.
  request(device) {
    if (!this.enabled() || !device?.id) return null;
    const entry = this.state.get(device.id);
    if (entry && this.now() < entry.nextAttemptAt) return null;
    if (this.running) return null; // one network sweep at a time covers every missing box
    this.running = this.heal(device).catch(error => {
      this.log("ERROR", "HARDWARE_IP_HEAL_FAILED", { hardwareRecordId: device.id, errorCode: error.code || "IP_HEAL_FAILED" });
    }).finally(() => { this.running = null; });
    return this.running;
  }

  schedule(id, success) {
    if (success) { this.state.delete(id); return; }
    const previous = this.state.get(id) || { attempts: 0, reportedMissing: false };
    const attempts = previous.attempts + 1;
    this.state.set(id, { attempts, reportedMissing: previous.reportedMissing, nextAttemptAt: this.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] });
  }

  async heal(trigger) {
    // Every box that is currently failing is looked for in the same sweep.
    const missing = this.repository.list().filter(device => ["OFFLINE", "UNKNOWN", "TIMEOUT"].includes(device.status) && Number(device.consecutiveFailures || 0) >= 1);
    const wanted = missing.some(device => device.id === trigger.id) ? missing : [...missing, trigger];
    const before = new Map(wanted.map(device => [device.id, device.ipAddress]));
    this.log("INFO", "HARDWARE_IP_HEAL_STARTED", { hardwareRecordId: trigger.id, savedIp: trigger.ipAddress });
    const session = await this.discovery.startAndWait("SYSTEM", { updateExisting: true, deepScan: true, overallTimeoutMs: this.scanTimeoutMs });
    for (const device of wanted) {
      const found = (session.results || []).find(item => item.deviceId === device.deviceId);
      if (found && found.ipChanged) {
        this.schedule(device.id, true);
        this.audit("HARDWARE_IP_AUTO_HEALED", "SYSTEM", { deviceId: device.id, controllerDeviceId: device.deviceId, previousIp: before.get(device.id), newIp: found.ipAddress, method: found.method });
        this.log("INFO", "HARDWARE_IP_AUTO_HEALED", { hardwareRecordId: device.id, previousIp: before.get(device.id), newIp: found.ipAddress, method: found.method });
        if (this.afterHeal) {
          try { await this.afterHeal(device.id); }
          catch (error) { this.log("WARN", "HARDWARE_IP_HEAL_RECHECK_FAILED", { hardwareRecordId: device.id, errorCode: error.code || "RECHECK_FAILED" }); }
        }
      } else if (found) {
        // Reachable at the saved address after all (a blip) — nothing to repoint.
        this.schedule(device.id, true);
      } else {
        this.schedule(device.id, false);
        const entry = this.state.get(device.id);
        // Audit once per outage, not once per retry, or a box that is simply switched off would fill the trail.
        if (!entry.reportedMissing) {
          entry.reportedMissing = true;
          this.audit("HARDWARE_IP_HEAL_NOT_FOUND", "SYSTEM", { deviceId: device.id, controllerDeviceId: device.deviceId, savedIp: device.ipAddress, scanState: session.state });
        }
      }
    }
  }
}

module.exports = { HardwareIpHealerService, BACKOFF_MS };
