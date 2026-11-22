"use strict";

// Small atomic file helpers for the AI Bridge's own files (config, token, outbox). These files live
// in <data>/config and never touch the POS store.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, data, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function removeFile(file) {
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

module.exports = { atomicWrite, readJson, removeFile };
