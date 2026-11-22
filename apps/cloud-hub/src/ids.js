'use strict';

// Random ids and secrets for the Cloud hub. Everything comes from node:crypto (CSPRNG).
const crypto = require('node:crypto');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Pairing code alphabet: A–Z and 2–9 without O/0/I/1 (BRIDGE_PROTOCOL §2). 32 symbols. */
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;

/** Pick `length` symbols from `alphabet` without modulo bias. */
function randomFromAlphabet(alphabet, length) {
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      // Reject bytes past the largest multiple of alphabet.length.
      if (byte >= 256 - (256 % alphabet.length)) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** ULID (Crockford base32, 26 chars): 48-bit ms timestamp + 80 random bits. */
function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + randomFromAlphabet(CROCKFORD, 16);
}

function pairingCode() {
  return randomFromAlphabet(PAIRING_ALPHABET, PAIRING_CODE_LENGTH);
}

function deviceId() {
  return `dev_${crypto.randomBytes(12).toString('base64url')}`;
}

/** S-5.2: 32 random bytes (256 bit), base64url without padding = 43 chars. */
function deviceToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** S-5.2: the Cloud stores only this hash, never the token itself. */
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time compare of two hex/utf8 strings. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  ulid,
  pairingCode,
  deviceId,
  deviceToken,
  sha256Hex,
  safeEqual,
};
