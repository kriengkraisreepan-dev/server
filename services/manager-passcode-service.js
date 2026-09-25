const { hashPassword, verifyPassword } = require("./auth-service");

class ManagerPasscodeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// A single shop-wide passcode, deliberately separate from anyone's login password, gating two
// things: the product screen and Void. The point is that whoever is logged in on the shared shop
// computer (their own account, at their own permission level) still cannot touch either without
// this extra secret — unlike a login password, it is not tied to one person, so knowing someone's
// login no longer implies knowing this too. Not set at all is a valid, permissive state (see
// index.js#requireElevation and the Void route): a fresh install or an upgrade must not suddenly
// lock staff out of screens that worked yesterday — the owner turns this on when ready, from
// Settings, the same way several other optional protections in this app ship off by default.
class ManagerPasscodeService {
  constructor({ clock = () => new Date(), policy = () => ({ maxAttempts: 5, lockMinutes: 15 }) } = {}) {
    this.clock = clock; this.policy = policy;
  }
  now() { return this.clock().toISOString(); }
  isSet(record) { return Boolean(record?.hash); }

  // Mutates `record` in place (lockout counters included) and throws on failure; the caller
  // persists the store either way, so a failed attempt's counter increment is never lost. A record
  // with no passcode set yet always succeeds — see the class comment above.
  verify(record, passcode) {
    if (!this.isSet(record)) return true;
    const { lockMinutes, maxAttempts } = this.policy();
    const now = Date.now();
    if (record.lockedUntil && new Date(record.lockedUntil).getTime() > now) { const error = new Error("รหัสผู้จัดการถูกล็อกชั่วคราวเพราะใส่ผิดหลายครั้ง"); error.code = "LOCKED"; throw error; }
    if (!passcode || !verifyPassword(String(passcode), record.hash)) {
      record.failedCount = (record.failedCount || 0) + 1;
      if (record.failedCount >= maxAttempts) record.lockedUntil = new Date(now + lockMinutes * 60 * 1000).toISOString();
      const error = new Error("รหัสผู้จัดการไม่ถูกต้อง"); error.code = "WRONG_PASSCODE"; throw error;
    }
    record.failedCount = 0; record.lockedUntil = null;
    return true;
  }

  // Setting it for the first time needs nothing but the new value; changing it needs the current
  // one too (verify() above), so knowing today's login password is never enough on its own to take
  // over the passcode as well. The emergency path (reset()) is the one deliberate exception, and it
  // marks mustChange so the owner is nudged to replace the known default.
  set(record, newPasscode, currentPasscode) {
    if (this.isSet(record)) this.verify(record, currentPasscode);
    let hash;
    try { hash = hashPassword(String(newPasscode || "")); }
    catch (cause) { const error = new Error(cause.message); error.code = "VALIDATION_ERROR"; throw error; }
    record.hash = hash;
    record.setAt = this.now();
    record.failedCount = 0; record.lockedUntil = null; record.mustChange = false;
    return record;
  }

  // Break-glass path (LUCKY_EMERGENCY_RESET_MANAGER_PASSCODE=1 at startup, mirroring the existing
  // admin-password reset) — resets to a known value and flags it so Settings can nag until changed.
  reset(record, temporaryPasscode = "00000000") {
    record.hash = hashPassword(temporaryPasscode);
    record.setAt = this.now();
    record.failedCount = 0; record.lockedUntil = null; record.mustChange = true;
    return record;
  }
}
module.exports = { ManagerPasscodeService, ManagerPasscodeError };
