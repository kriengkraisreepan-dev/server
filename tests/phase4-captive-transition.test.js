const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const apiSource = fs.readFileSync(path.join(root, "firmware/src/api/ApiServer.cpp"), "utf8");
const setupSource = fs.readFileSync(path.join(root, "firmware/src/setup/SetupModeService.cpp"), "utf8");
const portalScript = apiSource.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function portalContext(cryptoApi, responder) {
  const message = { textContent: "" };
  const elements = { msg: message };
  const context = {
    crypto: cryptoApi,
    document: { getElementById: id => elements[id] || (elements[id] = {}) },
    ssid: { value: "Lucky WiFi" },
    net: { value: "" },
    pass: { value: "secret-not-logged" },
    fetch: responder,
    setTimeout: () => 0,
    Uint8Array,
    Array,
    Error,
    JSON,
  };
  vm.createContext(context);
  vm.runInContext(portalScript, context);
  return { context, message };
}

test("Captive Portal works without crypto.randomUUID when getRandomValues exists", async () => {
  const requests = [];
  const transitionId = "a".repeat(48);
  const { context } = portalContext(
    { getRandomValues: bytes => (bytes.fill(0x5a), bytes) },
    async (url, options = {}) => {
      requests.push({ url, options });
      const payload = url.endsWith("/transition")
        ? { success: true, transitionId }
        : url.endsWith("/status")
          ? { provisioningState: "ORIGINAL_NETWORK_RESTORED" }
          : { success: true };
      return { ok: true, json: async () => payload };
    },
  );

  await context.save();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(requests[0].url, "/setup/api/transition");
  assert.match(JSON.parse(requests[0].options.body).clientNonce, /^[0-9a-f]{32}$/);
  const candidate = requests.find(request => request.url === "/setup/api/candidate");
  assert.ok(candidate, "candidate request should be sent after secure transition issuance");
  assert.equal(JSON.parse(candidate.options.body).transitionId, transitionId);
});

test("Captive Portal fails closed and does not send candidate without secure random", async () => {
  const requests = [];
  const { context, message } = portalContext(undefined, async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ success: true }) };
  });

  await context.save();

  assert.deepEqual(requests, []);
  assert.match(message.textContent, /Browser นี้ไม่รองรับ/);
  assert.doesNotMatch(message.textContent, /randomUUID|not a function|TypeError/);
});

test("Candidate is not sent when getRandomValues fails", async () => {
  const requests = [];
  const { context, message } = portalContext(
    { getRandomValues: () => { throw new Error("native secure random failure"); } },
    async url => {
      requests.push(url);
      return { ok: true, json: async () => ({ success: true }) };
    },
  );

  await context.save();

  assert.deepEqual(requests, []);
  assert.match(message.textContent, /ดำเนินการไม่สำเร็จ/);
  assert.doesNotMatch(message.textContent, /native secure random failure/);
});

test("Firmware owns transition IDs and existing portal lifecycle routes remain", () => {
  assert.ok(portalScript);
  assert.doesNotMatch(portalScript, /crypto\.randomUUID|Math\.random/);
  assert.match(portalScript, /crypto\.getRandomValues/);
  for (const route of ["/setup/api/auth", "/setup/api/networks", "/setup/api/status", "/setup/api/transition", "/setup/api/candidate", "/setup/api/commit", "/setup/api/rollback"]) {
    assert.ok(apiSource.includes(route), route);
  }
  assert.match(setupSource, /portalTransitionId_\s*=\s*randomToken\(\)/);
  assert.match(setupSource, /transitionId\s*!=\s*portalTransitionId_/);
  assert.match(setupSource, /esp_fill_random/);
  const issuance = setupSource.match(/bool SetupModeService::issueTransition[\s\S]*?\n}/)?.[0] || "";
  assert.doesNotMatch(issuance, /relay|turnAllOff|turnOn|turnOff/i);
});
