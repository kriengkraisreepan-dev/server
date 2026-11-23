"use strict";

// ULID for envelope ids (BRIDGE_PROTOCOL §4). node:crypto only.
const crypto = require("node:crypto");

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(now = Date.now()) {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (const byte of crypto.randomBytes(16)) rand += CROCKFORD[byte % 32];
  return time + rand;
}

module.exports = { ulid };
