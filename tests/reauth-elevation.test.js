const test = require("node:test");
const assert = require("node:assert/strict");
const { JsonUserRepository } = require("../repositories/json-user-repository");
const { AuthService } = require("../services/auth-service");

// Step-up re-authentication for a shared shop computer: an OWNER/MANAGER session can be left open,
// so the product screen and Void also need the password typed again. See
// AuthService#verifyCurrentPassword / #elevate.

function makeAuth(policy = { timeoutMinutes: 480, warningMinutes: 5, maxLoginAttempts: 3, lockDurationMinutes: 15 }) {
  const store = {};
  const repository = new JsonUserRepository({ getStore: () => store, save: () => {} });
  const auth = new AuthService(repository, () => new Date(), () => {}, () => policy);
  auth.bootstrap();
  const { token } = auth.login("admin", "123456789");
  return { auth, repository, token };
}

test("elevation needs the right password, lapses once its window passes, and can be dropped early", () => {
  const { auth, token } = makeAuth();
  assert.equal(auth.isElevated(token, "products"), false);
  assert.throws(() => auth.elevate(token, "wrong", "products", 10), err => err.code === "WRONG_PASSWORD");
  assert.equal(auth.isElevated(token, "products"), false);

  const result = auth.elevate(token, "123456789", "products", 10);
  assert.equal(result.scope, "products");
  assert.equal(auth.isElevated(token, "products"), true);
  assert.equal(auth.isElevated(token, "other-scope"), false, "a step-up is scoped, not a blanket unlock");

  // Ten idle minutes later it is gone; an action inside the window would have pushed it out again.
  auth.sessions.get(token).elevation.products = Date.now() - 1;
  assert.equal(auth.isElevated(token, "products"), false);
  auth.extendElevation(token, "products", 10);
  assert.equal(auth.isElevated(token, "products"), false, "an expired step-up cannot be revived by extending it");

  auth.elevate(token, "123456789", "products", 10);
  auth.extendElevation(token, "products", 10);
  assert.equal(auth.isElevated(token, "products"), true);
  auth.dropElevation(token, "products");
  assert.equal(auth.isElevated(token, "products"), false);
});

test("logging out takes any step-up with it", () => {
  const { auth, token } = makeAuth();
  auth.elevate(token, "123456789", "products", 10);
  auth.logout(token);
  assert.equal(auth.isElevated(token, "products"), false);
});

test("wrong passwords at the re-auth prompt count toward the same lockout as failed logins", () => {
  const { auth, repository } = makeAuth();
  assert.throws(() => auth.verifyCurrentPassword("admin", "x"), err => err.code === "WRONG_PASSWORD");
  assert.throws(() => auth.verifyCurrentPassword("admin", "y"), err => err.code === "WRONG_PASSWORD");
  assert.throws(() => auth.verifyCurrentPassword("admin", "z"), err => err.code === "WRONG_PASSWORD");
  assert.ok(repository.findById("admin").lockedUntil, "the third miss locks the account");
  // Once locked, even the right password is refused — otherwise the lock would be meaningless here.
  assert.throws(() => auth.verifyCurrentPassword("admin", "123456789"), err => err.code === "ACCOUNT_LOCKED");
});

test("a correct password clears earlier misses so they don't carry over into a later lockout", () => {
  const { auth, repository } = makeAuth();
  assert.throws(() => auth.verifyCurrentPassword("admin", "x"));
  assert.throws(() => auth.verifyCurrentPassword("admin", "y"));
  auth.verifyCurrentPassword("admin", "123456789");
  assert.equal(repository.findById("admin").failedLoginCount, 0);
  assert.equal(repository.findById("admin").lockedUntil, null);
});
