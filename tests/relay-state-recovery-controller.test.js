const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { RelayControllerDriver } = require("../drivers/relay-controller-driver");
const { HardwareService } = require("../services/hardware-service");
const { HardwareHealthMonitoringService } = require("../services/hardware-health-monitoring-service");

// The reported incident, reproduced against a stand-in controller that behaves like the real
// firmware: it deactivates every relay output when it boots (see firmware/src/main.cpp — the boot
// path runs turnAllOff() and has no record of which tables were lit) and its uptime restarts from
// zero. Tables 1 and 3 playing, table 2 lit by hand, staff switch table 2's relay off, the
// controller restarts — and before this fix every light in the shop stayed out until someone
// toggled each table again.

function stubController() {
  const state = { 1: "OFF", 2: "OFF", 3: "OFF", 4: "OFF" };
  const log = [];
  let uptimeSeconds = 3600;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://stub");
    const json = (status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (url.pathname === "/api/v1/health") {
      return json(200, { success: true, status: "HEALTHY", deviceId: "LRC-STUB", firmwareVersion: "1.2.0", uptimeSeconds, wifiConnected: true, rssi: -55, relayCount: 4, freeHeapBytes: 200000 });
    }
    if (url.pathname === "/api/v1/relays" && request.method === "GET") {
      return json(200, { success: true, relayCount: 4, relays: [1, 2, 3, 4].map(channel => ({ channel, state: state[channel], gpio: channel })) });
    }
    const match = /^\/api\/v1\/relays\/(\d+)\/state$/.exec(url.pathname);
    if (match && request.method === "POST") {
      let body = "";
      request.on("data", chunk => { body += chunk; });
      return request.on("end", () => {
        const channel = Number(match[1]);
        const desired = JSON.parse(body || "{}").state === "ON" ? "ON" : "OFF";
        state[channel] = desired;
        log.push(`${channel}:${desired}`);
        json(200, { success: true, channel, state: desired });
      });
    }
    json(404, { success: false, error: { code: "NOT_FOUND" } });
  });
  return {
    server, state, log,
    listen: () => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise(resolve => server.close(resolve)),
    // What the firmware does on boot: every output deactivated, millis() back to zero.
    reboot() { for (const channel of Object.keys(state)) state[channel] = "OFF"; uptimeSeconds = 3; log.push("REBOOT"); },
    setUptime: value => { uptimeSeconds = value; }
  };
}

test("a controller restart blacks out the shop, and the next health poll puts every light back", async t => {
  const controller = stubController();
  const port = await controller.listen();
  t.after(() => controller.close());

  const record = { id: "hw-1", deviceId: "LRC-STUB", ipAddress: "127.0.0.1", port, apiKey: "device-key", relayCount: 4, status: "ONLINE", consecutiveFailures: 0 };
  const repository = { list: () => [record], findById: id => (id === record.id ? record : null), update: (id, fields) => Object.assign(record, fields) };
  const tables = [
    { id: 1, name: "โต๊ะ 1", hardwareDeviceId: "hw-1", relayChannel: 1, status: "free" },
    { id: 2, name: "โต๊ะ 2", hardwareDeviceId: "hw-1", relayChannel: 2, status: "free" },
    { id: 3, name: "โต๊ะ 3", hardwareDeviceId: "hw-1", relayChannel: 3, status: "free" },
    { id: 4, name: "โต๊ะ 4", hardwareDeviceId: "hw-1", relayChannel: 4, status: "free" }
  ];
  const audits = [];
  const driver = new RelayControllerDriver({ timeoutMs: 2000 });
  const hardware = new HardwareService(repository, driver, {
    tables: () => tables,
    saveTables: () => {},
    audit: (event, actor, data) => audits.push({ event, data }),
    wait: async () => {}
  });
  const monitor = new HardwareHealthMonitoringService({
    repository, driver, audit: (event, actor, data) => audits.push({ event, data }),
    reconcileRelays: (deviceId, options) => hardware.reconcileRelayStates(deviceId, options)
  });

  // Tables 1 and 3 are opened for customers; table 2 is lit by hand for an empty table.
  tables[0].status = "playing";
  await hardware.setTableRelay(tables[0], "on");
  tables[2].status = "playing";
  await hardware.setTableRelay(tables[2], "on");
  await hardware.setTableRelay(tables[1], "on");
  assert.deepEqual([controller.state[1], controller.state[2], controller.state[3]], ["ON", "ON", "ON"]);

  await monitor.check("hw-1"); // establishes the uptime baseline

  // A customer arrives for table 2, so staff switch its light off before opening it...
  await hardware.setTableRelay(tables[1], "off");
  assert.deepEqual([controller.state[1], controller.state[2], controller.state[3]], ["ON", "OFF", "ON"], "only table 2 is commanded");

  // ...and the controller restarts (a coil switching browns it out), taking every light with it.
  controller.reboot();
  assert.deepEqual([controller.state[1], controller.state[2], controller.state[3]], ["OFF", "OFF", "OFF"], "the whole room goes dark — the reported symptom");

  await monitor.check("hw-1");

  assert.deepEqual([controller.state[1], controller.state[2], controller.state[3]], ["ON", "OFF", "ON"],
    "the two playing tables get their lights back; table 2 stays off because that is what staff asked for");
  assert.ok(audits.some(item => item.event === "HARDWARE_CONTROLLER_RESTARTED"), "and the restart is on record as the explanation");
  const restored = audits.find(item => item.event === "HARDWARE_RELAY_STATE_RESTORED");
  assert.ok(restored);
  assert.equal(restored.data.reason, "CONTROLLER_RESTARTED");
  assert.deepEqual(restored.data.corrected.map(item => item.tableId).sort(), [1, 3]);

  // A second poll with nothing wrong must not touch the board again.
  const commandsBefore = controller.log.length;
  controller.setUptime(120);
  await monitor.check("hw-1");
  assert.equal(controller.log.length, commandsBefore, "a healthy controller is polled, not commanded");
});
