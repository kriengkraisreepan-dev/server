const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { atomicWriteJson, readJsonWithRecovery, activeJsonWrites } = require("../infrastructure/safe-json-file");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-sprint10d-json-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("atomic JSON write leaves complete parseable primary and latest backup", t => {
  const file = path.join(temporaryDirectory(t), "store.json");
  atomicWriteJson(file, { revision: 1 });
  atomicWriteJson(file, { revision: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { revision: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")), { revision: 1 });
  assert.deepEqual(activeJsonWrites(), []);
  assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.endsWith(".tmp")), false);
});

test("truncated primary recovers from backup and preserves corrupt evidence", t => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, "reservations.json");
  atomicWriteJson(file, [{ id: "R1" }]);
  atomicWriteJson(file, [{ id: "R1" }, { id: "R2" }]);
  fs.writeFileSync(file, '[{"id":"broken"');
  const result = readJsonWithRecovery(file, { validate: Array.isArray });
  assert.equal(result.recovered, true);
  assert.deepEqual(result.value, [{ id: "R1" }]);
  assert.ok(fs.existsSync(result.corruptCopy));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), [{ id: "R1" }]);
});

test("invalid primary and invalid backup fail closed without creating empty data", t => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, "deposits.json");
  fs.writeFileSync(file, "{bad");
  fs.writeFileSync(`${file}.bak`, "");
  assert.throws(() => readJsonWithRecovery(file, { validate: Array.isArray, create: () => [] }), error => error.code === "JSON_RECOVERY_FAILED");
  assert.equal(fs.readFileSync(file, "utf8"), "{bad");
});

test("missing file may be initialized but an empty existing file may not", t => {
  const directory = temporaryDirectory(t);
  const missing = path.join(directory, "missing.json");
  assert.deepEqual(readJsonWithRecovery(missing, { validate: Array.isArray, create: () => [] }).value, []);
  const empty = path.join(directory, "empty.json");
  fs.writeFileSync(empty, "");
  assert.throws(() => readJsonWithRecovery(empty, { validate: Array.isArray, create: () => [] }), error => error.code === "JSON_RECOVERY_FAILED");
});
