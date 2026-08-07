const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { HardwareDiscoveryService } = require("../services/hardware-discovery-service");
const { HardwareRepository } = require("../repositories/hardware-repository");
const { HardwareService } = require("../services/hardware-service");
const {
  DISCOVERY_PORT, MAX_PACKET_BYTES, activeIpv4Interfaces, validateAnnouncement
} = require("../drivers/hardware-discovery-adapters");

function probe(id = "LRC-A1B2C3D4E5F6", count = 2, extra = {}) {
  return {
    health: { success: true, deviceId: id, deviceName: "Lucky Relay", relayCount: count, wifiConnected: true, rssi: -44, uptimeSeconds: 20, freeHeapBytes: 80000, ...extra.health },
    identity: { success: true, deviceId: id, deviceName: "Lucky Relay", firmwareVersion: "1.1.0", apiVersion: "1", hardwareStandard: "LHS-1.0", relayCount: count, ...extra.identity },
    config: { success: true, relayCount: count, ...extra.config },
    relays: { success: true, relayCount: count, relays: Array.from({ length: count }, (_, index) => ({ channel: index + 1, state: "OFF", gpio: 13 + index })), ...extra.relays }
  };
}

async function completed(service, started) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = service.get(started.id);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(current.state)) return current;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw Error("discovery did not finish");
}

function fixture({ devices = [], probes = {}, mdns = [], udp = [], interfaces = [] } = {}) {
  const updates = [], logs = [], calls = [];
  const repository = { list: () => devices };
  const hardwareService = { updateDiscoveredLocation: (id, value, method, options) => {
    calls.push({ op: "update", id, value, method, options });
    const device = devices.find(item => item.id === id);
    Object.assign(device, { ipAddress: value.ipAddress, deviceId: options.migrateIdentity ? value.deviceId : device.deviceId });
    return device;
  } };
  const driver = {
    probe: async device => {
      calls.push({ op: "probe", ip: device.ipAddress });
      const value = probes[device.ipAddress];
      if (value instanceof Error || !value) throw value || Object.assign(Error("offline"), { code: "DEVICE_OFFLINE" });
      return value;
    },
    request: async () => { throw Object.assign(Error("offline"), { code: "DEVICE_OFFLINE" }); }
  };
  const service = new HardwareDiscoveryService({
    repository, hardwareService, driver,
    mdns: { discover: async () => mdns },
    udp: { discover: async () => udp },
    interfaces: () => interfaces,
    log: (level, event, details) => logs.push({ level, event, details }),
    overallTimeoutMs: 1000
  });
  return { service, calls, logs, updates, devices };
}

test("discovery contract validates packets and private interfaces without credentials", () => {
  assert.equal(DISCOVERY_PORT, 42101);
  assert.equal(MAX_PACKET_BYTES, 512);
  const packet = validateAnnouncement({
    protocol: "lucky-relay-discovery", protocolVersion: 1, type: "announce",
    deviceId: "LRC-A1B2C3D4E5F6", deviceName: "Lucky", ip: "192.168.1.50",
    apiPort: 80, firmwareVersion: "1.1.0", apiVersion: "1", hardwareStandard: "LHS-1.0", relayCount: 4
  });
  assert.equal(packet.deviceId, "LRC-A1B2C3D4E5F6");
  assert.equal(JSON.stringify(packet).includes("apiKey"), false);
  assert.equal(validateAnnouncement({ protocol: "wrong" }), null);
  assert.equal(validateAnnouncement({ ...packet, protocol: "lucky-relay-discovery", protocolVersion: 2, type: "announce", ip: packet.ipAddress, apiPort: 80 }), null);
  const interfaces = activeIpv4Interfaces({
    WiFi: [{ family: "IPv4", internal: false, address: "192.168.1.105", netmask: "255.255.255.0" }],
    Loopback: [{ family: "IPv4", internal: true, address: "127.0.0.1", netmask: "255.0.0.0" }]
  });
  assert.deepEqual(interfaces, [{ name: "WiFi", address: "192.168.1.105", netmask: "255.255.255.0", network: "192.168.1.0", broadcast: "192.168.1.255" }]);
});

test("saved IP succeeds and updates only verified existing device", async () => {
  const device = { id: "hw-1", deviceId: "LRC-A1B2C3D4E5F6", ipAddress: "192.168.1.10", port: 80, apiKey: "secret" };
  const x = fixture({ devices: [device], probes: { "192.168.1.10": probe() } });
  const result = await completed(x.service, x.service.start("owner"));
  assert.equal(result.state, "COMPLETED");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].existingDeviceId, "hw-1");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(x.calls.filter(call => call.op === "update").length, 1);
});

test("saved IP failure falls through mDNS and verifies all four public endpoints", async () => {
  const x = fixture({
    devices: [{ id: "hw-1", deviceId: "LRC-OLD", ipAddress: "192.168.1.10", port: 80, apiKey: "secret" }],
    probes: { "192.168.1.50": probe("LRC-NEWDEVICE0001") },
    mdns: [{ ipAddress: "192.168.1.50", port: 80 }]
  });
  const result = await completed(x.service, x.service.start("owner"));
  assert.equal(result.results[0].deviceId, "LRC-NEWDEVICE0001");
  assert.equal(result.results[0].existingDevice, false);
  assert.deepEqual(x.calls.filter(call => call.op === "probe").map(call => call.ip), ["192.168.1.10", "192.168.1.50"]);
});

test("UDP supports multiple devices and deduplicates repeated announcements by Device ID", async () => {
  const x = fixture({
    probes: { "192.168.1.51": probe("LRC-DEVICE000001"), "192.168.1.52": probe("LRC-DEVICE000002"), "192.168.1.53": probe("LRC-DEVICE000001") },
    udp: [
      { ipAddress: "192.168.1.51", port: 80, deviceId: "LRC-DEVICE000001" },
      { ipAddress: "192.168.1.52", port: 80, deviceId: "LRC-DEVICE000002" },
      { ipAddress: "192.168.1.53", port: 80, deviceId: "LRC-DEVICE000001" }
    ]
  });
  const result = await completed(x.service, x.service.start("owner"));
  assert.deepEqual(result.results.map(item => item.deviceId).sort(), ["LRC-DEVICE000001", "LRC-DEVICE000002"]);
});

test("spoofed UDP identity and malformed Lucky HTTP response are rejected", async () => {
  const bad = probe("LRC-REALDEVICE001");
  bad.relays.relayCount = 4;
  const x = fixture({
    probes: { "192.168.1.60": bad },
    udp: [{ ipAddress: "192.168.1.60", port: 80, deviceId: "LRC-SPOOFED0001" }]
  });
  const result = await completed(x.service, x.service.start("owner"));
  assert.equal(result.results.length, 0);
  assert.ok(result.errors.length > 0);
});

test("legacy discovery never migrates automatically and requires user confirmation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-discovery-"));
  try {
    const repository = new HardwareRepository(path.join(dir, "hardware-devices.json"));
    const original = repository.create({ deviceName: "Legacy", deviceId: "LRC-0001", ipAddress: "192.168.1.70", port: 80, apiKey: "secret", relayCount: 2, status: "ONLINE" });
    const tables = [{ id: 1, hardwareDeviceId: original.id, relayChannel: 1 }];
    const hardwareService = new HardwareService(repository, {}, { tables: () => tables, saveTables: () => {}, audit: () => {} });
    const service = new HardwareDiscoveryService({
      repository, hardwareService,
      driver: { probe: async () => probe("LRC-AABBCCDDEEFF", 2, { identity: { previousDeviceId: "LRC-0001", identityMigrationVersion: 1 }, health: { previousDeviceId: "LRC-0001", identityMigrationVersion: 1 } }), request: async () => { throw Error("unused"); } },
      mdns: { discover: async () => [] }, udp: { discover: async () => [] }, interfaces: () => [], overallTimeoutMs: 1000
    });
    const result = await completed(service, service.start("owner"));
    assert.equal(result.results[0].identityMigrated, false);
    assert.equal(result.results[0].legacyMigration.requiresUserConfirmation, true);
    const saved = repository.list()[0];
    assert.equal(saved.id, original.id);
    assert.equal(saved.deviceId, "LRC-0001");
    assert.equal(saved.apiKey, "secret");
    assert.deepEqual(tables, [{ id: 1, hardwareDeviceId: original.id, relayChannel: 1 }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("ambiguous legacy records fail closed without updating either record", async () => {
  const devices = [
    { id: "hw-1", deviceId: "LRC-0001", deviceName: "Legacy A", ipAddress: "192.168.1.10", apiKey: "a" },
    { id: "hw-2", deviceId: "LRC-0001", deviceName: "Legacy B", ipAddress: "192.168.1.11", apiKey: "b" }
  ];
  const migrated = probe("LRC-AABBCCDDEEFF", 2, {
    identity: { previousDeviceId: "LRC-0001", identityMigrationVersion: 1 },
    health: { previousDeviceId: "LRC-0001", identityMigrationVersion: 1 }
  });
  const x = fixture({ devices, probes: { "192.168.1.10": migrated, "192.168.1.11": migrated } });
  const result = await completed(x.service, x.service.start("owner"));
  assert.equal(result.results[0].legacyMigration.ambiguous, true);
  assert.equal(x.calls.filter(call => call.op === "update").length, 0);
  assert.deepEqual(devices.map(device => device.deviceId), ["LRC-0001", "LRC-0001"]);
});

test("cancellation stops a discovery session and sessions can expire", async () => {
  let release;
  const service = new HardwareDiscoveryService({
    repository: { list: () => [] }, hardwareService: {}, driver: {},
    mdns: { discover: ({ signal }) => new Promise(resolve => { release = () => resolve([]); signal.addEventListener("abort", () => resolve([]), { once: true }); }) },
    udp: { discover: async () => [] }, interfaces: () => [], sessionTtlMs: 1, overallTimeoutMs: 1000
  });
  const started = service.start("owner");
  const cancelled = service.cancel(started.id);
  assert.equal(cancelled.state, "CANCELLED");
  release?.();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.throws(() => service.get(started.id), { code: "HARDWARE_DISCOVERY_NOT_FOUND" });
});

test("overall timeout fails safely and remains retryable", async () => {
  const service = new HardwareDiscoveryService({
    repository: { list: () => [] }, hardwareService: {}, driver: {},
    mdns: { discover: ({ signal }) => new Promise(resolve => signal.addEventListener("abort", () => resolve([]), { once: true })) },
    udp: { discover: async () => [] }, interfaces: () => [], overallTimeoutMs: 10
  });
  const result = await completed(service, service.start("owner"));
  assert.equal(result.state, "FAILED");
  assert.equal(result.retryable, true);
  assert.equal(result.errors.at(-1).code, "DISCOVERY_TIMEOUT");
});

test("subnet fallback is bounded by configured concurrency", async () => {
  let active = 0, peak = 0;
  const service = new HardwareDiscoveryService({
    repository: { list: () => [] }, hardwareService: {},
    driver: {
      request: async () => {
        active += 1; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active -= 1;
        throw Object.assign(Error("offline"), { code: "DEVICE_OFFLINE" });
      }
    },
    mdns: { discover: async () => [] }, udp: { discover: async () => [] },
    interfaces: () => [{ address: "192.168.8.10", network: "192.168.8.0" }],
    subnetConcurrency: 4, overallTimeoutMs: 2000
  });
  const result = await completed(service, service.start("owner"));
  assert.equal(result.state, "COMPLETED");
  assert.ok(peak > 1);
  assert.ok(peak <= 4);
});

test("discovered IP update keeps internal record and table mapping", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-discovery-update-"));
  try {
    const repository = new HardwareRepository(path.join(dir, "hardware-devices.json"));
    const original = repository.create({ deviceName: "Main", deviceId: "LRC-DEVICE000001", ipAddress: "192.168.1.10", port: 80, apiKey: "secret", relayCount: 2, status: "ONLINE" });
    const tables = [{ id: 1, hardwareDeviceId: original.id, relayChannel: 2 }];
    const service = new HardwareService(repository, {}, { tables: () => tables, saveTables: () => {}, audit: () => {} });
    service.updateDiscoveredLocation(original.id, {
      deviceId: original.deviceId, ipAddress: "192.168.1.99", port: 80, firmwareVersion: "1.1.0",
      apiVersion: "1", hardwareStandard: "LHS-1.0", relayCount: 2, health: { rssi: -50 }
    }, "UDP", { actorId: "owner" });
    const saved = repository.list()[0];
    assert.equal(saved.id, original.id);
    assert.equal(saved.ipAddress, "192.168.1.99");
    assert.equal(saved.apiKey, "secret");
    assert.deepEqual(tables, [{ id: 1, hardwareDeviceId: original.id, relayChannel: 2 }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
