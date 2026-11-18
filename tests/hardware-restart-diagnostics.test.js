const test = require("node:test");
const assert = require("node:assert/strict");
const { HardwareHealthMonitoringService } = require("../services/hardware-health-monitoring-service");

// A controller that rebooted between two polls, answering with whatever health payload the case needs.
function setup(healthPayload) {
  const record = { id: "hw-1", deviceId: "LRC-1", relayCount: 4, apiKey: "k", status: "ONLINE", ipAddress: "192.168.1.50", health: { uptimeSeconds: 5000 } };
  const audits = [];
  const repository = {
    findById: () => record,
    list: () => [record],
    update: (_id, fields) => Object.assign(record, fields)
  };
  const driver = { health: async () => ({ deviceId: "LRC-1", status: "HEALTHY", wifiConnected: true, relayCount: 4, uptimeSeconds: 12, ...healthPayload }) };
  const service = new HardwareHealthMonitoringService({ repository, driver, audit: (event, actor, data) => audits.push({ event, data }) });
  return { service, record, audits };
}

test("a restart is audited with the reset reason the firmware reports", async () => {
  const { service, record, audits } = setup({ resetReason: "BROWNOUT", storageEmptyAtBoot: false });
  await service.check("hw-1");
  const restart = audits.find(item => item.event === "HARDWARE_CONTROLLER_RESTARTED");
  assert.equal(restart.data.resetReason, "BROWNOUT");
  assert.equal(restart.data.storageEmptyAtBoot, false);
  assert.equal(restart.data.restartCause, undefined);
  assert.equal(record.health.resetReason, "BROWNOUT");
});

test("a deliberate Wi-Fi-offline restart is distinguishable from a crash", async () => {
  const { service, audits } = setup({ resetReason: "SW", restartCause: "WIFI_OFFLINE" });
  await service.check("hw-1");
  const restart = audits.find(item => item.event === "HARDWARE_CONTROLLER_RESTARTED");
  assert.equal(restart.data.resetReason, "SW");
  assert.equal(restart.data.restartCause, "WIFI_OFFLINE");
});

test("older firmware that reports no reason never gets one invented", async () => {
  const { service, record, audits } = setup({});
  await service.check("hw-1");
  const restart = audits.find(item => item.event === "HARDWARE_CONTROLLER_RESTARTED");
  assert.ok(restart);
  assert.equal("resetReason" in restart.data, false);
  assert.equal("resetReason" in record.health, false);
});
