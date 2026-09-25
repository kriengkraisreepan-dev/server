const test = require("node:test");
const assert = require("node:assert/strict");
const { ManagerPasscodeService } = require("../services/manager-passcode-service");

// The shared "manager passcode" gates the product screen and Void, deliberately separate from any
// one person's login password — see ManagerPasscodeService's own comment for why.

function makeService(policy = { maxAttempts: 3, lockMinutes: 15 }) {
  return new ManagerPasscodeService({ clock: () => new Date("2026-09-25T00:00:00.000Z"), policy: () => policy });
}

test("an unset passcode is permissive — an upgrade must not lock anyone out on day one", () => {
  const service = makeService();
  const record = {};
  assert.equal(service.isSet(record), false);
  assert.equal(service.verify(record, "anything at all"), true);
  assert.equal(service.verify(record, ""), true);
});

test("once set, only the right value verifies, and the wrong one is rejected without setting isSet", () => {
  const service = makeService();
  const record = {};
  service.set(record, "shopwide1");
  assert.equal(service.isSet(record), true);
  assert.equal(service.verify(record, "shopwide1"), true);
  assert.throws(() => service.verify(record, "wrong"), err => err.code === "WRONG_PASSCODE");
});

test("changing it needs the current value; setting it the first time does not", () => {
  const service = makeService();
  const record = {};
  service.set(record, "first-value"); // no current needed yet
  assert.throws(() => service.set(record, "second-value", "not-the-current-one"), err => err.code === "WRONG_PASSCODE");
  service.set(record, "second-value", "first-value");
  assert.equal(service.verify(record, "second-value"), true);
  assert.throws(() => service.verify(record, "first-value"), err => err.code === "WRONG_PASSCODE", "the old value must stop working immediately");
});

test("a too-short new passcode is rejected with a VALIDATION_ERROR, not left half-set", () => {
  const service = makeService();
  const record = {};
  assert.throws(() => service.set(record, "short"), err => err.code === "VALIDATION_ERROR");
  assert.equal(service.isSet(record), false);
});

test("enough wrong attempts locks it out, even against the right value, until the window passes", () => {
  const service = makeService({ maxAttempts: 3, lockMinutes: 15 });
  const record = {};
  service.set(record, "shopwide1");
  assert.throws(() => service.verify(record, "a")); assert.throws(() => service.verify(record, "b")); assert.throws(() => service.verify(record, "c"));
  assert.ok(record.lockedUntil);
  assert.throws(() => service.verify(record, "shopwide1"), err => err.code === "LOCKED");
  // Once the lock window has passed, the counters are stale but the lock itself is no longer active.
  record.lockedUntil = new Date(Date.now() - 1000).toISOString();
  assert.equal(service.verify(record, "shopwide1"), true);
});

test("reset() is the emergency path: known value, and it flags mustChange for Settings to nag about", () => {
  const service = makeService();
  const record = { hash: "stale", failedCount: 5, lockedUntil: "2026-01-01T00:00:00.000Z" };
  service.reset(record);
  assert.equal(record.mustChange, true);
  assert.equal(record.failedCount, 0);
  assert.equal(record.lockedUntil, null);
  assert.equal(service.verify(record, "00000000"), true);
  // A normal set() afterwards (the owner actually changing it) clears the nag.
  service.set(record, "real-value", "00000000");
  assert.equal(record.mustChange, false);
});
