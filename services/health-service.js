class HealthService {
  constructor({ dataFiles, activeTimers, activeWrites, backups, integrity, recovery, relay = () => "NOT_CONFIGURED", startedAt = Date.now() }) {
    Object.assign(this, { dataFiles, activeTimers, activeWrites, backups, integrity, recovery, relay, startedAt });
  }
  status() {
    const files = this.dataFiles().map(item => ({ name: item.name, exists: item.exists, parseable: item.parseable, bytes: item.bytes }));
    const integrity = this.integrity();
    const backup = this.backups();
    const pendingRecoveryItems = this.recovery().pending || [];
    const critical = files.some(item => !item.exists || !item.parseable) || integrity.status === "ERROR";
    const warning = !critical && (integrity.status === "WARNING" || pendingRecoveryItems.length || backup.verificationStatus !== "VERIFIED");
    return {
      status: critical ? "CRITICAL" : warning ? "WARNING" : "HEALTHY",
      server: "RUNNING",
      jsonFiles: files,
      repositories: files.every(item => item.exists && item.parseable) ? "READY" : "ERROR",
      activeTimers: this.activeTimers(),
      activeJsonWrites: this.activeWrites().length,
      backup,
      integrity: { status: integrity.status, errors: integrity.errors, warnings: integrity.warnings },
      relayConnectivity: this.relay(),
      pendingRecoveryItems,
      memoryUsage: process.memoryUsage(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000)
    };
  }
}

module.exports = { HealthService };
