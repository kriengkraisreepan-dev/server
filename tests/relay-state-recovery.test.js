const test = require("node:test");
const assert = require("node:assert/strict");
const { HardwareService } = require("../services/hardware-service");

// The reported fault: tables 1 and 3 playing, table 2 lit manually for an empty table, staff press
// "ปิด Relay" on table 2 to open it for an arriving customer — and every light in the shop goes
// out at once. No server path turns more than one channel off, but the controller deactivates
// every output when it boots and cannot know which tables were lit, so any restart (a brownout as
// a coil switches is the classic cause) blacks out the room while the app still shows the tables
// playing. Nothing put them back. These cover the recovery that now does.

function table(id, channel, overrides = {}) {
  return { id, name: `โต๊ะ ${id}`, hardwareDeviceId: "hw-1", relayChannel: channel, status: "free", ...overrides };
}
function harness({ tables, relays, failChannels = [], device = {} } = {}) {
  const record = { id: "hw-1", deviceId: "LRC-A", status: "ONLINE", apiKey: "k", relayCount: 4, ...device };
  const commands = [], audits = [], logs = [];
  let saves = 0;
  const driver = {
    async relays() { if (relays instanceof Error) throw relays; return { relayCount: 4, relays }; },
    async setRelayState(_device, channel, on) {
      if (failChannels.includes(channel)) throw Object.assign(new Error("offline"), { code: "DEVICE_TIMEOUT" });
      commands.push({ channel, state: on ? "ON" : "OFF" });
    }
  };
  const service = new HardwareService({ findById: () => record }, driver, {
    tables: () => tables,
    saveTables: () => { saves += 1; },
    audit: (event, actor, data) => audits.push({ event, actor, data }),
    log: (level, event, data) => logs.push({ level, event, data }),
    wait: async () => {}
  });
  return { service, commands, audits, logs, tables, saves: () => saves };
}
const on = channel => ({ channel, state: "ON" });
const off = channel => ({ channel, state: "OFF" });

test("after the controller reboots, only the tables that should be lit are switched back on", async () => {
  const h = harness({
    tables: [
      table(1, 1, { status: "playing", relayDesiredState: "on", relayState: "on" }),
      table(2, 2, { status: "free", relayDesiredState: "off", relayState: "off" }),
      table(3, 3, { status: "playing", relayDesiredState: "on", relayState: "on" }),
      table(4, 4)
    ],
    relays: [off(1), off(2), off(3), off(4)] // what a freshly booted controller reports
  });
  const result = await h.service.reconcileRelayStates("hw-1", { reason: "CONTROLLER_RESTARTED" });
  assert.deepEqual(h.commands, [{ channel: 1, state: "ON" }, { channel: 3, state: "ON" }]);
  assert.deepEqual(result.corrected.map(item => item.tableId), [1, 3]);
  assert.equal(h.tables[0].relayState, "on");
  assert.equal(h.tables[2].relayActualState, "on");
  assert.equal(h.saves(), 1);
  const audit = h.audits.find(item => item.event === "HARDWARE_RELAY_STATE_RESTORED");
  assert.ok(audit);
  assert.equal(audit.data.reason, "CONTROLLER_RESTARTED");
});

test("the light a member of staff turned on for an empty table comes back too", async () => {
  // Table 2 has no customer but was lit deliberately — that is a desired state like any other and
  // must survive a reboot, or staff find the room half dark for no visible reason.
  const h = harness({
    tables: [table(2, 2, { status: "free", relayDesiredState: "on", relayState: "on" })],
    relays: [off(1), off(2), off(3), off(4)]
  });
  await h.service.reconcileRelayStates("hw-1");
  assert.deepEqual(h.commands, [{ channel: 2, state: "ON" }]);
});

test("a healthy controller is left completely alone", async () => {
  const h = harness({
    tables: [
      table(1, 1, { status: "playing", relayDesiredState: "on" }),
      table(2, 2, { status: "free", relayDesiredState: "off" })
    ],
    relays: [on(1), off(2), off(3), off(4)]
  });
  const result = await h.service.reconcileRelayStates("hw-1");
  assert.deepEqual(h.commands, [], "nothing disagreed, so no coil is switched");
  assert.deepEqual(result.corrected, []);
  assert.equal(h.saves(), 0, "and nothing is written");
  assert.equal(h.audits.length, 0, "and the audit trail is not filled with no-ops");
});

test("a relay left on that the app believes is off is switched off", async () => {
  const h = harness({
    tables: [table(2, 2, { status: "free", relayDesiredState: "off", relayState: "off" })],
    relays: [off(1), on(2), off(3), off(4)]
  });
  await h.service.reconcileRelayStates("hw-1");
  assert.deepEqual(h.commands, [{ channel: 2, state: "OFF" }]);
});

test("a table nobody has ever commanded is never switched", async () => {
  const h = harness({
    tables: [table(4, 4)], // no relayDesiredState, no relayState, not playing
    relays: [off(1), off(2), off(3), on(4)]
  });
  await h.service.reconcileRelayStates("hw-1");
  assert.deepEqual(h.commands, [], "recovery restores what was asked for; it never invents a state");
});

test("a playing table with no recorded relay state is still treated as needing its light", async () => {
  const h = harness({
    tables: [table(1, 1, { status: "playing" })],
    relays: [off(1), off(2), off(3), off(4)]
  });
  await h.service.reconcileRelayStates("hw-1");
  assert.deepEqual(h.commands, [{ channel: 1, state: "ON" }]);
});

test("a channel the controller does not report is left alone rather than driven blindly", async () => {
  // Mapping points at channel 4 but the board is configured for 2 — a configuration problem, and
  // driving it would only produce an invalid-channel error on every poll.
  const h = harness({
    tables: [table(4, 4, { status: "playing", relayDesiredState: "on" })],
    relays: [off(1), off(2)]
  });
  const result = await h.service.reconcileRelayStates("hw-1");
  assert.deepEqual(h.commands, []);
  assert.deepEqual(result.corrected, []);
});

test("one table failing to come back does not stop the others, and is left marked pending", async () => {
  const h = harness({
    tables: [
      table(1, 1, { status: "playing", relayDesiredState: "on" }),
      table(3, 3, { status: "playing", relayDesiredState: "on" })
    ],
    relays: [off(1), off(2), off(3), off(4)],
    failChannels: [1]
  });
  const result = await h.service.reconcileRelayStates("hw-1");
  assert.deepEqual(h.commands, [{ channel: 3, state: "ON" }], "table 3 still gets its light back");
  assert.deepEqual(result.failed.map(item => item.tableId), [1]);
  assert.equal(h.tables[0].relayPending, true, "and the failure stays visible in health");
  assert.ok(h.logs.some(item => item.level === "ERROR" && item.event === "HARDWARE_RELAY_STATE_RESTORED"));
});

test("an offline controller is not commanded", async () => {
  const h = harness({
    tables: [table(1, 1, { status: "playing", relayDesiredState: "on" })],
    relays: [off(1)],
    device: { status: "OFFLINE" }
  });
  assert.deepEqual((await h.service.reconcileRelayStates("hw-1")).corrected, []);
  assert.deepEqual(h.commands, []);
});

test("a controller that cannot be read is reported, not guessed at", async () => {
  const h = harness({
    tables: [table(1, 1, { status: "playing", relayDesiredState: "on" })],
    relays: Object.assign(new Error("timeout"), { code: "DEVICE_TIMEOUT" })
  });
  const result = await h.service.reconcileRelayStates("hw-1");
  assert.equal(result.unreachable, true);
  assert.deepEqual(h.commands, [], "without knowing the board's real state, nothing is switched");
  assert.ok(h.logs.some(item => item.event === "HARDWARE_RELAY_RECONCILE_READ_FAILED"));
});

test("coils are switched one at a time, never all at once", async () => {
  // Energising several coils together is what browns the controller out in the first place, and
  // this runs immediately after it has rebooted.
  const waits = [];
  const record = { id: "hw-1", deviceId: "LRC-A", status: "ONLINE", apiKey: "k", relayCount: 4 };
  const order = [];
  const service = new HardwareService({ findById: () => record }, {
    async relays() { return { relays: [off(1), off(2), off(3), off(4)] }; },
    async setRelayState(_device, channel) { order.push(`set-${channel}`); }
  }, {
    tables: () => [table(1, 1, { status: "playing" }), table(3, 3, { status: "playing" })],
    saveTables: () => {},
    wait: async ms => { waits.push(ms); order.push(`wait-${ms}`); }
  });
  await service.reconcileRelayStates("hw-1");
  assert.deepEqual(order, ["set-1", "wait-250", "set-3", "wait-250"]);
  assert.ok(waits.every(ms => ms > 0));
});
