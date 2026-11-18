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

test("tables lit from the wall switch, unmapped or on another box, do not block flashing this board", async () => {
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

test("a board that cannot say who it is, or still has a relay on, blocks while anything is in play", async () => {
  const tables = [{ id: 1, name: "โต๊ะ 1", status: "playing" }];
  assert.equal((await flashSafetyVerdict({ tables, devices, identify: () => null })).safe, false);
  assert.equal((await flashSafetyVerdict({ tables, devices, identify: () => { throw new Error("busy"); } })).safe, false);
  const lit = await flashSafetyVerdict({ tables, devices, identify: () => ({ ...board, relaysOff: false, activeChannels: [2] }) });
  assert.equal(lit.safe, false);
  assert.match(lit.message, /ช่อง 2/);
});

// The flasher asks the board over USB once, keeps the answer for the second check, and surfaces the
// verdict's message instead of the old generic one.
function flasher(tables, transportResponses) {
  const requests = [];
  const recoveryTransport = { request: (port, payload) => { requests.push(payload.command); return transportResponses[payload.command]; } };
  const service = new UsbFlasherService({ portProvider: { list: () => [] }, recoveryTransport, relaySafe: ({ identify }) => flashSafetyVerdict({ tables, devices, identify }) });
  const csrf = service.issueCsrf("owner");
  const { operationToken } = service.issueToken("owner", csrf.csrfToken);
  return { service, requests, operationToken };
}
const responses = { IDENTIFY: { ok: true, deviceId: "LRC-40F226CA4B70", relayCount: 8, firmwareVersion: "1.2.0" }, GET_RELAY_SAFETY: { ok: true, safe: true, activeChannels: [] } };

test("start refuses with the tables that are actually in the way", async () => {
  const { service, operationToken } = flasher([{ id: 2, name: "โต๊ะ 2", status: "playing", hardwareDeviceId: "hw-old" }], responses);
  await assert.rejects(service.start({ mode: "new", port: "COM3", operationToken, destructiveConfirmation: "ERASE NEW DEVICE", relayCount: 4 }, "owner"),
    error => error.code === "RELAY_SAFE_STATE_CONFLICT" && /โต๊ะ 2/.test(error.message));
});

test("the board is asked once per operation; the check after esptool resets it reuses the answer", async () => {
  const { service, requests } = flasher([{ id: 1, name: "โต๊ะ 1", status: "playing" }], responses);
  const board = { port: "COM3" };
  await service.assertFlashSafe(board, "fallback");
  await service.assertFlashSafe(board, "fallback");
  assert.deepEqual(requests, ["IDENTIFY", "GET_RELAY_SAFETY"]);
});

test("a relaySafe that still answers a bare boolean keeps the old messages", async () => {
  const service = new UsbFlasherService({ portProvider: { list: () => [] }, relaySafe: async () => false });
  await assert.rejects(service.assertFlashSafe({ port: "COM3" }, "กรุณาปิด Relay ทุกช่องผ่านขั้นตอนปกติก่อน"), /กรุณาปิด Relay ทุกช่อง/);
});

test("start goes ahead while customers play on tables that do not depend on this board", async () => {
  const { service, requests, operationToken } = flasher([{ id: 1, name: "โต๊ะ 1", status: "playing" }], responses);
  const operation = await service.start({ mode: "new", port: "COM3", operationToken, destructiveConfirmation: "ERASE NEW DEVICE", relayCount: 4 }, "owner");
  assert.equal(operation.mode, "new");
  assert.equal("board" in operation, false);
  assert.deepEqual(requests, ["IDENTIFY", "GET_RELAY_SAFETY"]);
});
