const test = require("node:test");
const assert = require("node:assert/strict");
const { HardwareDiscoveryService } = require("../services/hardware-discovery-service");
const { HardwareHealthMonitoringService } = require("../services/hardware-health-monitoring-service");
const { HardwareIpHealerService, BACKOFF_MS } = require("../services/hardware-ip-healer-service");

// A router restart hands the relay boxes new DHCP addresses. These cover the pieces that notice the
// dead address, go and find the box, and repoint the saved record without a person pressing anything.

function probe(id, count = 2) {
  return {
    health: { success: true, deviceId: id, deviceName: "Lucky Relay", relayCount: count, wifiConnected: true, rssi: -44, uptimeSeconds: 20, freeHeapBytes: 80000 },
    identity: { success: true, deviceId: id, deviceName: "Lucky Relay", firmwareVersion: "1.1.0", apiVersion: "1", hardwareStandard: "LHS-1.0", relayCount: count },
    config: { success: true, relayCount: count },
    relays: { success: true, relayCount: count, relays: Array.from({ length: count }, (_, index) => ({ channel: index + 1, state: "OFF", gpio: 13 + index })) }
  };
}

function discoveryFixture({ devices, probes, mdns = [], udp = [], subnetHosts = {}, interfaces = [] }) {
  const calls = [];
  const repository = { list: () => devices };
  const hardwareService = {
    updateDiscoveredLocation: (id, value) => {
      const device = devices.find(item => item.id === id);
      calls.push({ id, ip: value.ipAddress });
      device.ipAddress = value.ipAddress;
      return device;
    }
  };
  const driver = {
    probe: async device => {
      const value = probes[device.ipAddress];
      if (!value) throw Object.assign(Error("offline"), { code: "DEVICE_OFFLINE" });
      return value;
    },
    request: async ({ ipAddress }) => {
      if (subnetHosts[ipAddress]) return { success: true, deviceId: subnetHosts[ipAddress] };
      throw Object.assign(Error("offline"), { code: "DEVICE_OFFLINE" });
    }
  };
  const service = new HardwareDiscoveryService({
    repository, hardwareService, driver,
    mdns: { discover: async () => mdns }, udp: { discover: async () => udp },
    interfaces: () => interfaces, overallTimeoutMs: 2000
  });
  return { service, calls, devices };
}

test("two boxes that swapped addresses are each matched to their own record", async () => {
  const devices = [
    { id: "hw-a", deviceId: "LRC-AAAAAAAAAAAA", ipAddress: "192.168.1.10", port: 80 },
    { id: "hw-b", deviceId: "LRC-BBBBBBBBBBBB", ipAddress: "192.168.1.11", port: 80 }
  ];
  // After the router restart A answers at .11 and B at .10 — each saved address now belongs to the other box.
  const fixture = discoveryFixture({
    devices,
    probes: { "192.168.1.10": probe("LRC-BBBBBBBBBBBB"), "192.168.1.11": probe("LRC-AAAAAAAAAAAA") },
    mdns: [{ ipAddress: "192.168.1.11", port: 80 }, { ipAddress: "192.168.1.10", port: 80 }]
  });
  const session = await fixture.service.startAndWait("SYSTEM");
  assert.equal(session.state, "COMPLETED");
  assert.equal(devices.find(d => d.id === "hw-a").ipAddress, "192.168.1.11");
  assert.equal(devices.find(d => d.id === "hw-b").ipAddress, "192.168.1.10");
});

test("deepScan keeps sweeping the subnet for a missing box even when another one was already found", async () => {
  const devices = [
    { id: "hw-a", deviceId: "LRC-AAAAAAAAAAAA", ipAddress: "192.168.1.10", port: 80 },
    { id: "hw-b", deviceId: "LRC-BBBBBBBBBBBB", ipAddress: "192.168.1.11", port: 80 }
  ];
  const make = () => discoveryFixture({
    devices: devices.map(d => ({ ...d })),
    probes: { "192.168.1.10": probe("LRC-AAAAAAAAAAAA"), "192.168.1.77": probe("LRC-BBBBBBBBBBBB") },
    subnetHosts: { "192.168.1.77": "LRC-BBBBBBBBBBBB" },
    interfaces: [{ address: "192.168.1.2" }]
  });
  const plain = make();
  await plain.service.startAndWait("SYSTEM");
  assert.equal(plain.devices.find(d => d.id === "hw-b").ipAddress, "192.168.1.11", "a normal run stops once anything was found");
  const deep = make();
  await deep.service.startAndWait("SYSTEM", { deepScan: true });
  assert.equal(deep.devices.find(d => d.id === "hw-b").ipAddress, "192.168.1.77");
});

function healerFixture({ session, devices }) {
  let clock = 1000000;
  const audits = [], rechecks = [], starts = [];
  const discovery = { startAndWait: async (actor, options) => { starts.push({ actor, options }); return typeof session === "function" ? session() : session; } };
  const healer = new HardwareIpHealerService({
    discovery, repository: { list: () => devices },
    audit: (event, actor, data) => audits.push({ event, actor, data }),
    afterHeal: async id => { rechecks.push(id); },
    now: () => clock
  });
  return { healer, audits, rechecks, starts, advance: ms => { clock += ms; } };
}
const offline = (extra = {}) => ({ id: "hw-1", deviceId: "LRC-A", ipAddress: "192.168.1.10", status: "OFFLINE", consecutiveFailures: 3, ...extra });

test("a box found at a new address is audited as healed and re-checked straight away", async () => {
  const device = offline();
  const h = healerFixture({ devices: [device], session: { state: "COMPLETED", results: [{ deviceId: "LRC-A", ipAddress: "192.168.1.55", ipChanged: true, method: "MDNS" }] } });
  await h.healer.request(device);
  assert.deepEqual(h.rechecks, ["hw-1"]);
  const audit = h.audits.find(a => a.event === "HARDWARE_IP_AUTO_HEALED");
  assert.equal(audit.data.previousIp, "192.168.1.10");
  assert.equal(audit.data.newIp, "192.168.1.55");
  assert.equal(h.starts[0].options.deepScan, true);
});

test("a box that is simply switched off is retried with backoff and reported once per outage", async () => {
  const device = offline();
  const h = healerFixture({ devices: [device], session: { state: "COMPLETED", results: [] } });
  await h.healer.request(device);
  assert.equal(h.starts.length, 1);
  assert.equal(h.healer.request(device), null, "inside the backoff window nothing is started");
  h.advance(BACKOFF_MS[0] + 1);
  await h.healer.request(device);
  assert.equal(h.starts.length, 2);
  assert.equal(h.audits.filter(a => a.event === "HARDWARE_IP_HEAL_NOT_FOUND").length, 1);
});

test("only one network sweep runs at a time, and a disabled healer does nothing", async () => {
  const devices = [offline(), offline({ id: "hw-2", deviceId: "LRC-B", ipAddress: "192.168.1.11" })];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = healerFixture({ devices, session: async () => { await gate; return { state: "COMPLETED", results: [] }; } });
  const first = h.healer.request(devices[0]);
  assert.equal(h.healer.request(devices[1]), null);
  release(); await first;
  assert.equal(h.starts.length, 1);

  const off = new HardwareIpHealerService({ discovery: {}, repository: { list: () => [] }, enabled: () => false });
  assert.equal(off.request(devices[0]), null);
});

test("a discovery crash is contained and never reaches the health poll", async () => {
  const device = offline();
  const h = healerFixture({ devices: [device], session: () => { throw Object.assign(Error("boom"), { code: "DISCOVERY_FAILED" }); } });
  await h.healer.request(device); // must resolve, not reject
  assert.equal(h.audits.length, 0);
});

test("health monitor asks the healer only after repeated failures, and a throwing hook cannot break the poll", async () => {
  const record = { id: "hw-1", deviceId: "LRC-A", deviceName: "A", ipAddress: "192.168.1.10", port: 80, apiKey: "k", relayCount: 4, firmwareVersion: "1.1.0", status: "UNKNOWN", consecutiveFailures: 0 };
  const repo = { list: () => [record], findById: () => record, update: (id, fields) => Object.assign(record, fields) };
  const requested = [];
  const monitor = new HardwareHealthMonitoringService({
    repository: repo,
    driver: { async health() { throw Object.assign(Error("x"), { code: "DEVICE_TIMEOUT" }); } },
    onUnreachable: (device, info) => { requested.push(info.failures); throw Error("hook bug"); }
  });
  await monitor.check("hw-1");
  assert.deepEqual(requested, [], "one failure is a dropped packet, not a moved box");
  const second = await monitor.check("hw-1");
  assert.deepEqual(requested, [2]);
  assert.equal(second.lastErrorCode, "DEVICE_TIMEOUT");
});
