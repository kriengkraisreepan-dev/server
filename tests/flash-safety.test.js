const test = require("node:test");
const assert = require("node:assert/strict");
const { flashSafetyVerdict } = require("../services/flash-safety");
const { UsbFlasherService } = require("../services/usb-flasher-service");

const board = { deviceId: "LRC-40F226CA4B70", relaysOff: true, activeChannels: [] };
const devices = [{ id: "hw-old", deviceId: "LRC-40F226CA4B70" }, { id: "hw-other", deviceId: "LRC-OTHER" }];

test("with no table in play the board is never even asked", async () => {
  let asked = 0;
  const verdict = await flashSafetyVerdict({ tables: [{ id: 1, status: "free", hardwareDeviceId: "hw-old" }], devices, identify: () => { asked += 1; return board; } });
  assert.deepEqual(verdict, { safe: true });
  assert.equal(asked, 0);
});

test("tables in play that drive no controller never need the board, even one that cannot answer", async () => {
  // The shop on 2026-11-18: customers on tables lit from the wall switch, every table unmapped, and a
  // blank controller on COM3 that answers nothing. That must not block the flash.
  let asked = 0;
  const tables = [{ id: 1, name: "โต๊ะ 1", status: "playing" }, { id: 2, name: "โต๊ะ 2", status: "paused" }, { id: 3, name: "โต๊ะ 3", status: "awaiting_payment" }];
  const verdict = await flashSafetyVerdict({ tables, devices: [], identify: () => { asked += 1; throw new Error("no answer"); } });
  assert.deepEqual(verdict, { safe: true });
  assert.equal(asked, 0);
});

test("a table in play on another box does not block flashing this board", async () => {
  const tables = [{ id: 1, name: "โต๊ะ 1", status: "playing" }, { id: 2, name: "โต๊ะ 2", status: "paused", hardwareDeviceId: "hw-other" }];
  assert.deepEqual(await flashSafetyVerdict({ tables, devices, identify: () => board }), { safe: true });
});

test("a table in play on this board blocks, and says which", async () => {
  const tables = [{ id: 3, name: "โต๊ะ 3", status: "awaiting_payment", hardwareDeviceId: "hw-old" }, { id: 4, name: "โต๊ะ 4", status: "playing" }];
  const verdict = await flashSafetyVerdict({ tables, devices, identify: () => board });
  assert.equal(verdict.safe, false);
  assert.match(verdict.message, /โต๊ะ 3/);
  assert.doesNotMatch(verdict.message, /โต๊ะ 4/);
});

test("when a mapped table is in play, a board that cannot say who it is, or has a relay on, still blocks", async () => {
  const tables = [{ id: 1, name: "โต๊ะ 1", status: "playing", hardwareDeviceId: "hw-other" }];
  const silent = await flashSafetyVerdict({ tables, devices, identify: () => null });
  assert.equal(silent.safe, false);
  assert.match(silent.message, /โต๊ะ 1/);
  assert.equal((await flashSafetyVerdict({ tables, devices, identify: () => { throw new Error("busy"); } })).safe, false);
  const lit = await flashSafetyVerdict({ tables, devices, identify: () => ({ ...board, relaysOff: false, activeChannels: [2] }) });
  assert.equal(lit.safe, false);
  assert.match(lit.message, /ช่อง 2/);
});

// The flasher asks the board over USB at most once, keeps the answer for the second check, and surfaces
// the verdict's message instead of the old generic one.
function flasher(tables, transportResponses) {
  const requests = [];
  const recoveryTransport = { request: (port, payload) => { requests.push(payload.command); return transportResponses[payload.command]; } };
  const service = new UsbFlasherService({ portProvider: { list: () => [] }, recoveryTransport, relaySafe: ({ identify }) => flashSafetyVerdict({ tables, devices, identify }) });
  const csrf = service.issueCsrf("owner");
  const { operationToken } = service.issueToken("owner", csrf.csrfToken);
  return { service, requests, operationToken };
}
const responses = { IDENTIFY: { ok: true, deviceId: "LRC-40F226CA4B70", relayCount: 8, firmwareVersion: "1.2.0" }, GET_RELAY_SAFETY: { ok: true, safe: true, activeChannels: [] } };
const startArgs = operationToken => ({ mode: "new", port: "COM3", operationToken, destructiveConfirmation: "ERASE NEW DEVICE", relayCount: 4 });

test("start refuses with the tables that are actually in the way", async () => {
  const { service, operationToken } = flasher([{ id: 2, name: "โต๊ะ 2", status: "playing", hardwareDeviceId: "hw-old" }], responses);
  await assert.rejects(service.start(startArgs(operationToken), "owner"), error => error.code === "RELAY_SAFE_STATE_CONFLICT" && /โต๊ะ 2/.test(error.message));
});

test("the board is asked once per operation; the check after esptool resets it reuses the answer", async () => {
  const { service, requests } = flasher([{ id: 1, name: "โต๊ะ 1", status: "playing", hardwareDeviceId: "hw-other" }], responses);
  const state = { port: "COM3" };
  await service.assertFlashSafe(state, "fallback");
  await service.assertFlashSafe(state, "fallback");
  assert.deepEqual(requests, ["IDENTIFY", "GET_RELAY_SAFETY"]);
});

test("a relaySafe that still answers a bare boolean keeps the old messages", async () => {
  const service = new UsbFlasherService({ portProvider: { list: () => [] }, relaySafe: async () => false });
  await assert.rejects(service.assertFlashSafe({ port: "COM3" }, "กรุณาปิด Relay ทุกช่องผ่านขั้นตอนปกติก่อน"), /กรุณาปิด Relay ทุกช่อง/);
});

test("start goes ahead without touching the serial port while customers play on unmapped tables", async () => {
  const { service, requests, operationToken } = flasher([{ id: 1, name: "โต๊ะ 1", status: "playing" }, { id: 2, name: "โต๊ะ 2", status: "paused" }], {});
  const operation = await service.start(startArgs(operationToken), "owner");
  assert.equal(operation.mode, "new");
  assert.equal("board" in operation, false);
  assert.deepEqual(requests, []);
});

test("start goes ahead while customers play on a table that depends on another board", async () => {
  const { service, requests, operationToken } = flasher([{ id: 1, name: "โต๊ะ 1", status: "playing", hardwareDeviceId: "hw-other" }], responses);
  const operation = await service.start(startArgs(operationToken), "owner");
  assert.equal(operation.mode, "new");
  assert.deepEqual(requests, ["IDENTIFY", "GET_RELAY_SAFETY"]);
});
