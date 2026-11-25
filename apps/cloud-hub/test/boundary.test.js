'use strict';

// S-1.1 / S-1.2: the Cloud hub is a separate app. It must not require anything from the
// 88Snooker Manager app (Relay, Hardware, billing, signing, OTA, firmware…). The only path
// outside apps/cloud-hub it may use is the bridge-protocol package.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
// A4 adds @anthropic-ai/sdk (Claude API) and yaml (dev only: evals/chat.yaml).
// A5 adds playwright-core (post renderer) and pngjs (dev only: image tests).
const ALLOWED_PACKAGES = new Set(['express', 'ws', 'pg', 'zod', '@electric-sql/pglite', '@88snooker/bridge-protocol', '@anthropic-ai/sdk', 'yaml', 'playwright-core', 'pngjs']);

function* jsFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(p);
    else if (entry.name.endsWith('.js')) yield p;
  }
}

test('cloud-hub only requires its own files, node built-ins and allowed packages', () => {
  const offenders = [];
  for (const file of jsFiles(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), spec);
        if (!resolved.startsWith(ROOT + path.sep)) offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
        continue;
      }
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!ALLOWED_PACKAGES.has(pkg)) offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no source file mentions relay, hardware, billing, signing, OTA or firmware modules', () => {
  const banned = /require\([^)]*(relay|hardware|billing|signing|firmware|ota|esp32|installer)[^)]*\)/i;
  for (const file of jsFiles(path.join(ROOT, 'src'))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), banned, path.relative(ROOT, file));
  }
});

test('installed bridge-protocol copy matches packages/bridge-protocol (re-run npm install if this fails)', () => {
  const src = path.join(ROOT, '..', '..', 'packages', 'bridge-protocol', 'src');
  const installed = path.join(ROOT, 'node_modules', '@88snooker', 'bridge-protocol', 'src');
  const digest = (dir) => {
    const h = crypto.createHash('sha256');
    for (const f of fs.readdirSync(dir).sort()) h.update(f).update(fs.readFileSync(path.join(dir, f)));
    return h.digest('hex');
  };
  assert.equal(digest(installed), digest(src));
});
