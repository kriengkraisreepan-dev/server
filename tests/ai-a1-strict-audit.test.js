'use strict';

// Task A1 — structural audit of the bridge-protocol package.
// Every zod object reachable from an exported schema must be strict (S-2.1), and the
// package may only depend on zod and its own files (S-1.1: no path to Relay/Hardware/billing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bp = require('../packages/bridge-protocol');

const PKG_DIR = path.join(__dirname, '..', 'packages', 'bridge-protocol');

function isSchema(value) {
  return Boolean(value && typeof value === 'object' && value._zod && value._zod.def);
}

/** Walk a schema tree and return paths of objects that are not strict. */
function findNonStrict(schema, where, seen = new Set(), out = []) {
  if (!isSchema(schema) || seen.has(schema)) return out;
  seen.add(schema);
  const def = schema._zod.def;
  switch (def.type) {
    case 'object': {
      if (!def.catchall || def.catchall._zod.def.type !== 'never') out.push(where);
      for (const [k, v] of Object.entries(def.shape)) findNonStrict(v, `${where}.${k}`, seen, out);
      break;
    }
    case 'array': findNonStrict(def.element, `${where}[]`, seen, out); break;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly': findNonStrict(def.innerType, where, seen, out); break;
    case 'union': def.options.forEach((o, i) => findNonStrict(o, `${where}|${i}`, seen, out)); break;
    case 'pipe': findNonStrict(def.in, where, seen, out); findNonStrict(def.out, where, seen, out); break;
    case 'record':
    case 'map':
    case 'intersection':
    case 'tuple':
      out.push(`${where} (${def.type} not allowed in protocol)`);
      break;
    default: break;
  }
  return out;
}

test('A1 S-2.1: every object in every exported schema is strict', () => {
  const exported = Object.entries(bp).filter(([, v]) => isSchema(v));
  const fromMaps = Object.entries(bp.MESSAGE_SCHEMAS);
  assert.ok(exported.length > 10);
  const problems = [];
  for (const [name, schema] of [...exported, ...fromMaps]) findNonStrict(schema, name, new Set(), problems);
  assert.deepEqual(problems, []);
});

test('A1 audit self-check: a non-strict object is detected', () => {
  const { z } = require('zod');
  assert.deepEqual(findNonStrict(z.strictObject({ a: z.object({ b: z.string() }) }), 'x'), ['x.a']);
});

test('A1 S-1.1: package requires only zod and its own files', () => {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(PKG_DIR);
  assert.ok(files.length >= 6);
  const bad = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (/\bimport\s*\(|\bimport\s+[\w{*]/.test(src)) bad.push(`${file}: import`);
    for (const m of src.matchAll(/require\(\s*([^)]*)\)/g)) {
      const arg = m[1].trim();
      const lit = /^['"]([^'"]+)['"]$/.exec(arg);
      if (!lit) { bad.push(`${file}: dynamic require(${arg})`); continue; }
      const spec = lit[1];
      if (spec === 'zod') continue;
      if (spec.startsWith('./')) {
        const resolved = path.resolve(path.dirname(file), spec);
        if (resolved.startsWith(PKG_DIR + path.sep)) continue;
      }
      bad.push(`${file}: require('${spec}')`);
    }
  }
  assert.deepEqual(bad, []);
});

test('A1: package declares zod as its only dependency, pinned exactly', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
  const root = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, { zod: root.dependencies.zod });
  assert.match(root.dependencies.zod, /^\d+\.\d+\.\d+$/);
});
