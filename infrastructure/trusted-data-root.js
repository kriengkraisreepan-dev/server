const fs = require("fs");
const path = require("path");

const SUBDIRECTORIES = Object.freeze(["database", "backups", "config", "license", "logs", "uploads", "update-staging", "migration", "runtime"]);

function pathError(code, message) { return Object.assign(new Error(message), { code }); }
function canonicalExistingParent(target) {
  let cursor = path.resolve(target), suffix = [];
  while (!fs.existsSync(cursor)) { const parent = path.dirname(cursor); if (parent === cursor) break; suffix.unshift(path.basename(cursor)); cursor = parent; }
  const real = fs.realpathSync.native(cursor);
  return path.join(real, ...suffix);
}
function isWithin(parent, child) { const relative = path.relative(parent, child); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); }

function validateDataRoot(input, { programRoot, workspaceRoot, platform = process.platform, allowWorkspaceTestRoot = false } = {}) {
  if (typeof input !== "string" || !path.isAbsolute(input)) throw pathError("DATA_ROOT_ABSOLUTE_REQUIRED", "Customer Data root ต้องเป็น absolute path");
  if (platform === "win32" && (/^\\\\/.test(input) || /^\\\?\\UNC\\/i.test(input))) throw pathError("DATA_ROOT_UNC_REJECTED", "ไม่อนุญาต Customer Data บน UNC path");
  const resolved = path.resolve(input), parsed = path.parse(resolved);
  if (resolved === parsed.root) throw pathError("DATA_ROOT_DRIVE_ROOT_REJECTED", "ห้ามใช้ drive root เป็น Customer Data");
  const canonical = canonicalExistingParent(resolved);
  const permittedTestRoot = allowWorkspaceTestRoot && workspaceRoot && isWithin(canonicalExistingParent(path.join(workspaceRoot, "runtime", "electron-test-user-data")), canonical);
  for (const forbidden of [permittedTestRoot ? null : programRoot, permittedTestRoot ? null : workspaceRoot].filter(Boolean).map(value => canonicalExistingParent(value))) {
    if (canonical === forbidden || isWithin(forbidden, canonical)) throw pathError("DATA_ROOT_FORBIDDEN_LOCATION", "Customer Data ต้องแยกจาก Program และ workspace root");
  }
  const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramW6432].filter(Boolean).map(value => path.resolve(value));
  if (programFiles.some(root => canonical === root || isWithin(root, canonical))) throw pathError("DATA_ROOT_PROGRAM_FILES_REJECTED", "Customer Data ห้ามอยู่ใต้ Program Files");
  return canonical;
}

function prepareDataLayout(root, options = {}) {
  const canonical = validateDataRoot(root, options);
  fs.mkdirSync(canonical, { recursive: true, mode: 0o700 });
  const realRoot = fs.realpathSync.native(canonical);
  const paths = { root: realRoot };
  for (const name of SUBDIRECTORIES) {
    const target = path.join(realRoot, name); fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    const real = fs.realpathSync.native(target);
    if (!isWithin(realRoot, real)) throw pathError("DATA_ROOT_SYMLINK_ESCAPE", `Subdirectory ${name} ออกจาก Customer Data root`);
    paths[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = real;
  }
  return Object.freeze(paths);
}

function resolveServerDataLayout({ env = process.env, applicationRoot = path.resolve(__dirname, "..") } = {}) {
  const configured = env.LUCKY_DATA_ROOT;
  if (!configured && env.LUCKY_DATA_DIR) {
    const legacy = path.resolve(env.LUCKY_DATA_DIR);
    return { root: legacy, database: legacy, backups: path.join(legacy, "backups"), logs: path.join(legacy, "logs"), uploads: path.join(legacy, "uploads"), updateStaging: path.join(legacy, "update-staging"), migration: path.join(legacy, "migration"), config: path.join(legacy, "config"), license: path.join(legacy, "license"), runtime: path.join(legacy, "runtime"), legacyDevelopmentMode: true };
  }
  if (!configured) {
    const legacy = path.join(applicationRoot, "data");
    console.warn("LUCKY_DATA_ROOT_NOT_SET: using legacy development data directory");
    return { root: legacy, database: legacy, backups: path.join(legacy, "backups"), logs: path.join(legacy, "logs"), uploads: path.join(legacy, "uploads"), updateStaging: path.join(legacy, "update-staging"), migration: path.join(legacy, "migration"), config: path.join(legacy, "config"), license: path.join(legacy, "license"), runtime: path.join(legacy, "runtime"), legacyDevelopmentMode: true };
  }
  return { ...prepareDataLayout(configured, { programRoot: env.LUCKY_PROGRAM_ROOT, workspaceRoot: env.LUCKY_WORKSPACE_ROOT, allowWorkspaceTestRoot: env.LUCKY_ALLOW_WORKSPACE_TEST_ROOT === "1" }), legacyDevelopmentMode: false };
}

module.exports = { SUBDIRECTORIES, validateDataRoot, prepareDataLayout, resolveServerDataLayout, isWithin };
