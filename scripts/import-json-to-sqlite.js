#!/usr/bin/env node
const path = require("path");
const { importJsonStore } = require("../database/json-importer");

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const source = value("--source"), target = value("--target"), dryRun = args.includes("--dry-run"), confirmed = args.includes("--confirm");
if (!source || !target || (!dryRun && !confirmed)) {
  console.error("Usage: node scripts/import-json-to-sqlite.js --source <store.json> --target <new.sqlite> --dry-run | --confirm");
  process.exitCode = 2;
} else {
  try {
    const report = importJsonStore({ sourcePath: path.resolve(source), targetPath: path.resolve(target), dryRun });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(`Import failed: ${error.message}`); process.exitCode = 1; }
}
