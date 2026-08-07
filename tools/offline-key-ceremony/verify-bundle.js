"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = __dirname, manifestPath = path.join(root, "TOOL-MANIFEST.json");
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.classification !== "OFFLINE PRODUCTION KEY CEREMONY TOOL — NO PRIVATE KEY INCLUDED" || !Array.isArray(manifest.files)) throw new Error("Manifest contract ไม่ถูกต้อง");
  const expected = new Set(manifest.files.map(item => item.path));
  const actual = fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isFile() && item.name !== "TOOL-MANIFEST.json").map(item => item.name).sort();
  if (actual.length !== expected.size || actual.some(name => !expected.has(name))) throw new Error("รายการไฟล์ไม่ตรง manifest");
  for (const item of manifest.files) {
    if (!/^[A-Za-z0-9._-]+$/.test(item.path)) throw new Error("Path ใน manifest ไม่ถูกต้อง");
    const file = path.join(root, item.path), data = fs.readFileSync(file);
    const digest = crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
    if (data.length !== item.size || digest !== item.sha256) throw new Error(`SHA-256 ไม่ตรง: ${item.path}`);
  }
  console.log("BUNDLE VERIFICATION: PASS");
  console.log(`Node.js: ${manifest.node.version}`);
  console.log(`Node signer: ${manifest.node.signer}`);
  console.log("Private Key Included: NO");
} catch (error) { console.error(`BUNDLE VERIFICATION: FAILED — ${error.message}`); process.exitCode = 1; }
