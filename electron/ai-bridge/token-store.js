"use strict";

// Device token storage — S-5.2 / BRIDGE_PROTOCOL §2.5: only ever written encrypted with Electron
// safeStorage (DPAPI on Windows). If encryption is not available the token is refused, never
// written in plaintext.
const fs = require("node:fs");
const path = require("node:path");
const { atomicWrite } = require("./files");

class TokenStoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function createTokenStore({ file, safeStorage }) {
  if (!file) throw new TypeError("file is required");
  return {
    available() {
      try { return Boolean(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
    },
    save(token) {
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new TokenStoreError("TOKEN_INVALID", "device token ไม่ถูกต้อง");
      if (!this.available()) throw new TokenStoreError("SAFE_STORAGE_UNAVAILABLE", "เครื่องนี้เข้ารหัส token ไม่ได้ (safeStorage) จึงไม่บันทึก");
      const encrypted = safeStorage.encryptString(token);
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.includes(Buffer.from(token))) throw new TokenStoreError("SAFE_STORAGE_FAILED", "เข้ารหัส token ไม่สำเร็จ");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      atomicWrite(file, encrypted);
    },
    load() {
      let data;
      try { data = fs.readFileSync(file); } catch { return null; }
      if (!this.available()) return null;
      try {
        const token = safeStorage.decryptString(data);
        return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
      } catch {
        return null;
      }
    },
    has() { return fs.existsSync(file); },
    clear() {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    },
  };
}

module.exports = { createTokenStore, TokenStoreError };
