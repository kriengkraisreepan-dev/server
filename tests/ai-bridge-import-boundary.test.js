"use strict";

// A3 acceptance / SAFETY S-1.1, S-1.2: the AI Bridge's whole require() graph must never reach Relay,
// Hardware, billing/payment writes, firmware, signing, OTA, drivers, repositories or the POS store.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ENTRY_POINTS = [
  ...fs.readdirSync(path.join(root, "electron/ai-bridge")).filter(f => f.endsWith(".js")).map(f => path.join(root, "electron/ai-bridge", f)),
  path.join(root, "services/ai-snapshot-source.js"),
];
const FORBIDDEN_PATH = /relay|hardware|billing|payment|deposit|firmware|signing|sign-|ota|flash|usb|nvs|esp32|drivers[\\/]|repositories[\\/]|store\.json|pos-order|table-session|backup|recovery|installer|release/i;
const FORBIDDEN_BUILTINS = new Set(["child_process", "node:child_process", "electron", "serialport", "dgram", "node:dgram", "net", "node:net"]);
const ALLOWED_PACKAGES = new Set(["zod", "ws"]);

function requiresOf(file) {
  const src = fs.readFileSync(file, "utf8");
  return [...src.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(m => m[1]);
}

function walk() {
  const seen = new Set(), externals = new Set(), stack = [...ENTRY_POINTS];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of requiresOf(file)) {
      if (spec.startsWith(".")) {
        const resolved = require.resolve(path.resolve(path.dirname(file), spec));
        stack.push(resolved);
      } else {
        externals.add(spec);
      }
    }
  }
  return { files: [...seen].map(f => path.relative(root, f).split(path.sep).join("/")), externals: [...externals] };
}

test("A3 S-1.1/S-1.2: ai-bridge import graph has no path to Relay/Hardware/billing/firmware/POS writes", () => {
  const { files, externals } = walk();
  assert.ok(files.includes("electron/ai-bridge/connection.js"), "graph walked the bridge");
  assert.ok(files.includes("packages/bridge-protocol/src/index.js"), "graph walked bridge-protocol");
  const bad = files.filter(f => FORBIDDEN_PATH.test(f) || f === "index.js" || f.startsWith("services/") && f !== "services/ai-snapshot-source.js");
  assert.deepEqual(bad, [], `forbidden modules reachable from ai-bridge: ${bad.join(", ")}`);
  for (const ext of externals) {
    if (ext.startsWith("node:") && !FORBIDDEN_BUILTINS.has(ext)) continue;
    assert.ok(!FORBIDDEN_BUILTINS.has(ext), `forbidden builtin ${ext}`);
    assert.ok(ALLOWED_PACKAGES.has(ext) || ["fs", "path", "crypto", "events"].includes(ext), `unexpected package ${ext}`);
  }
});

test("A3 S-1.2: services/ai-snapshot-source.js requires nothing at all", () => {
  assert.deepEqual(requiresOf(path.join(root, "services/ai-snapshot-source.js")), []);
});

test("A3 S-1.2: the bridge only GETs the backend; it has no POS API call", () => {
  const src = fs.readFileSync(path.join(root, "electron/ai-bridge/source-client.js"), "utf8");
  assert.match(src, /method: "GET"/);
  for (const f of ENTRY_POINTS) {
    const code = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(code, /\/api\/(tables|bills|pos-orders|reservations|hardware|relay|payments|backups)/, `${path.basename(f)} must not call POS routes`);
  }
});

test("A3: electron-builder ships bridge-protocol", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(pkg.build.files.includes("packages/bridge-protocol/**/*"));
  assert.ok(pkg.dependencies.ws, "ws is a runtime dependency");
});
