const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SUBDIRECTORIES, validateDataRoot, prepareDataLayout, resolveServerDataLayout } = require("../infrastructure/trusted-data-root");

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), "lucky-6a-root-")); }
test("customer-data layout creates only allowlisted isolated directories", t => {
  const base = temporary(); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const program = path.join(base, "program"), data = path.join(base, "customer"); fs.mkdirSync(program);
  const layout = prepareDataLayout(data, { programRoot: program, workspaceRoot: program });
  assert.notEqual(layout.root, program);
  assert.deepEqual(fs.readdirSync(data).sort(), [...SUBDIRECTORIES].sort());
  for (const name of SUBDIRECTORIES) assert.equal(fs.statSync(path.join(data, name)).isDirectory(), true);
});

test("relative, root, program, workspace and traversal-equivalent roots are rejected", t => {
  const base = temporary(); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const program = path.join(base, "program"); fs.mkdirSync(program);
  assert.throws(() => validateDataRoot("relative/data", { programRoot: program, workspaceRoot: program }), { code: "DATA_ROOT_ABSOLUTE_REQUIRED" });
  assert.throws(() => validateDataRoot(path.parse(base).root, { programRoot: program, workspaceRoot: program }), { code: "DATA_ROOT_DRIVE_ROOT_REJECTED" });
  assert.throws(() => validateDataRoot(program, { programRoot: program, workspaceRoot: program }), { code: "DATA_ROOT_FORBIDDEN_LOCATION" });
  assert.throws(() => validateDataRoot(path.join(program, "..", "program", "data"), { programRoot: program, workspaceRoot: program }), { code: "DATA_ROOT_FORBIDDEN_LOCATION" });
});

test("workspace test exception is narrow and production mode rejects it", t => {
  const base = temporary(); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const workspace = path.join(base, "workspace"), allowed = path.join(workspace, "runtime", "electron-test-user-data", "run-1"); fs.mkdirSync(workspace);
  assert.throws(() => validateDataRoot(allowed, { programRoot: workspace, workspaceRoot: workspace }), { code: "DATA_ROOT_FORBIDDEN_LOCATION" });
  assert.equal(validateDataRoot(allowed, { programRoot: workspace, workspaceRoot: workspace, allowWorkspaceTestRoot: true }), path.join(fs.realpathSync.native(workspace), "runtime", "electron-test-user-data", "run-1"));
  assert.throws(() => validateDataRoot(path.join(workspace, "runtime", "other"), { programRoot: workspace, workspaceRoot: workspace, allowWorkspaceTestRoot: true }), { code: "DATA_ROOT_FORBIDDEN_LOCATION" });
});

test("symlink or junction escape in an allowlisted subdirectory fails closed", t => {
  const base = temporary(); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const data = path.join(base, "data"), outside = path.join(base, "outside"), program = path.join(base, "program");
  fs.mkdirSync(data); fs.mkdirSync(outside); fs.mkdirSync(program);
  fs.symlinkSync(outside, path.join(data, "database"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => prepareDataLayout(data, { programRoot: program, workspaceRoot: program }), { code: "DATA_ROOT_SYMLINK_ESCAPE" });
});

test("server supports separated contract and legacy development compatibility", t => {
  const base = temporary(); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const program = path.join(base, "program"), data = path.join(base, "customer"); fs.mkdirSync(program);
  const separated = resolveServerDataLayout({ env: { LUCKY_DATA_ROOT: data, LUCKY_PROGRAM_ROOT: program, LUCKY_WORKSPACE_ROOT: program }, applicationRoot: program });
  assert.equal(separated.database, path.join(fs.realpathSync.native(data), "database")); assert.equal(separated.legacyDevelopmentMode, false);
  const legacy = resolveServerDataLayout({ env: {}, applicationRoot: program });
  assert.equal(legacy.database, path.join(program, "data")); assert.equal(legacy.legacyDevelopmentMode, true);
});
