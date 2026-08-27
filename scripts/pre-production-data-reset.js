const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { atomicWriteJson } = require("../infrastructure/safe-json-file");

const projectRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(projectRoot, "data");
const backupRoot = path.join(dataRoot, "backups");
// Bills, payments, orders, sessions and the audit trail live here as month files rather than
// inside store.json (see infrastructure/history-store.js). A reset that cleared store.json but
// left these behind would leave the shop's test trading in the "clean" baseline.
const historyRoot = path.join(dataRoot, "history");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archiveRoot = path.join(projectRoot, "output", `pre-production-archive-${stamp}`);
const requiredFiles = ["store.json", "reservations.json", "reservation-deposits.json"];
const optionalFiles = requiredFiles.map(name => `${name}.bak`);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function copyIntoArchive(source, relative) {
  const destination = path.join(archiveRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(destination, 0o600); } catch {}
  return {
    path: relative.replaceAll("\\", "/"),
    bytes: fs.statSync(destination).size,
    sha256: sha256(destination)
  };
}

function main() {
  if (process.env.LUCKY_CONFIRM_PRODUCTION_RESET !== "YES_DELETE_TEST_DATA") {
    fail("RESET_CONFIRMATION_REQUIRED", "Production reset confirmation is missing");
  }
  if (fs.existsSync(archiveRoot)) fail("ARCHIVE_ALREADY_EXISTS", "Archive path already exists");
  for (const name of requiredFiles) {
    if (!fs.existsSync(path.join(dataRoot, name))) fail("DATA_FILE_MISSING", `${name} is missing`);
  }

  const storeFile = path.join(dataRoot, "store.json");
  const reservationFile = path.join(dataRoot, "reservations.json");
  const depositFile = path.join(dataRoot, "reservation-deposits.json");
  const store = readJson(storeFile);
  const reservations = readJson(reservationFile);
  const deposits = readJson(depositFile);
  if (!store || typeof store !== "object" || Array.isArray(store)) fail("STORE_INVALID", "store.json is invalid");
  if (!Array.isArray(reservations) || !Array.isArray(deposits)) fail("RESERVATION_DATA_INVALID", "Reservation data is invalid");
  if (!Array.isArray(store.tables) || store.tables.some(table => table.status !== "free" || table.runtimeSessionId)) {
    fail("ACTIVE_TABLE_BLOCKS_RESET", "Every table must be free with no runtime session");
  }
  const owners = (store.users || []).filter(user => user.role === "OWNER" && user.status === "ACTIVE");
  if (owners.length !== 1 || owners[0].username !== "admin") {
    fail("OWNER_AMBIGUOUS", "Exactly one active admin OWNER must remain");
  }
  if (!Array.isArray(store.products) || store.products.length !== 5) {
    fail("PRODUCT_COUNT_MISMATCH", "Expected exactly five products before reset");
  }

  fs.mkdirSync(archiveRoot, { recursive: false });
  const archived = [];
  for (const name of [...requiredFiles, ...optionalFiles]) {
    const source = path.join(dataRoot, name);
    if (fs.existsSync(source)) archived.push(copyIntoArchive(source, path.join("data", name)));
  }
  const oldBackups = fs.existsSync(backupRoot)
    ? fs.readdirSync(backupRoot, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name)
    : [];
  for (const name of oldBackups) archived.push(copyIntoArchive(path.join(backupRoot, name), path.join("backups", name)));
  const historyFiles = fs.existsSync(historyRoot)
    ? fs.readdirSync(historyRoot, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".jsonl")).map(entry => entry.name)
    : [];
  for (const name of historyFiles) archived.push(copyIntoArchive(path.join(historyRoot, name), path.join("history", name)));

  const before = {
    members: (store.members || []).length,
    bills: (store.bills || []).length,
    payments: (store.payments || []).length,
    tableSessions: (store.tableSessions || []).length,
    users: (store.users || []).length,
    auditLogs: (store.auditLogs || []).length,
    stockMovements: (store.stockMovements || []).length,
    posOrders: (store.posOrders || []).length,
    memberPointTransactions: (store.memberPointTransactions || []).length,
    reservations: reservations.length,
    reservationDeposits: deposits.length,
    backups: oldBackups.length,
    historyFiles: historyFiles.length
  };

  const resetAt = new Date().toISOString();
  const resetStore = {
    ...store,
    tables: store.tables.map(table => ({
      ...table,
      status: "free",
      memberId: null,
      startTime: null,
      items: [],
      runtimeSessionId: null
    })),
    members: [],
    products: store.products.map(product => ({ ...product, stockQuantity: 0 })),
    bills: [],
    payments: [],
    tableSessions: [],
    users: [owners[0]],
    auditLogs: [{
      id: crypto.randomUUID(),
      occurredAt: resetAt,
      event: "PRODUCTION_DATA_RESET_COMPLETED",
      tableId: null,
      sessionId: null,
      billId: null,
      paymentId: null,
      actorId: owners[0].id || owners[0].userId || "admin",
      userId: owners[0].id || owners[0].userId || "admin",
      details: { resetAt, archivedFiles: archived.length }
    }],
    stockMovements: [],
    posOrders: [],
    memberPointTransactions: [],
    // Already at the current layout, so the server must not treat this baseline as a legacy
    // store and re-run the one-time history migration against it.
    historySchemaVersion: 1,
    auditEventTypes: ["PRODUCTION_DATA_RESET_COMPLETED"]
  };

  atomicWriteJson(storeFile, resetStore);
  atomicWriteJson(reservationFile, []);
  atomicWriteJson(depositFile, []);
  // The pre-reset versions already exist in the immutable recovery archive.
  // Keep local recovery copies aligned with the clean production baseline so
  // normal JSON recovery cannot restore test transactions later.
  for (const file of [storeFile, reservationFile, depositFile]) {
    fs.copyFileSync(file, `${file}.bak`);
    try { fs.chmodSync(`${file}.bak`, 0o600); } catch {}
  }

  for (const name of oldBackups) {
    const target = path.resolve(backupRoot, name);
    if (path.dirname(target) !== path.resolve(backupRoot)) fail("BACKUP_PATH_INVALID", "Backup path escaped root");
    fs.unlinkSync(target);
  }

  for (const name of historyFiles) {
    const target = path.resolve(historyRoot, name);
    if (path.dirname(target) !== path.resolve(historyRoot)) fail("HISTORY_PATH_INVALID", "History path escaped root");
    fs.unlinkSync(target);
  }

  const manifest = {
    schemaVersion: 1,
    operation: "PRE_PRODUCTION_DATA_RESET",
    createdAt: resetAt,
    recovery: "Stop the server, verify this manifest, then restore the archived data files manually.",
    before,
    retained: {
      settings: true,
      tables: resetStore.tables.length,
      ownerUsername: owners[0].username,
      products: resetStore.products.length,
      productStockQuantity: 0,
      productCategories: (resetStore.productCategories || []).length,
      hardwareRecordsChanged: false
    },
    files: archived
  };
  const manifestFile = path.join(archiveRoot, "MANIFEST.json");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });

  const verification = {
    store: readJson(storeFile),
    reservations: readJson(reservationFile),
    deposits: readJson(depositFile)
  };
  const zeroSections = ["members", "bills", "payments", "tableSessions", "stockMovements", "posOrders", "memberPointTransactions"];
  if (zeroSections.some(key => !Array.isArray(verification.store[key]) || verification.store[key].length !== 0)) {
    fail("RESET_VERIFY_FAILED", "A transactional store section was not cleared");
  }
  if (verification.reservations.length || verification.deposits.length) fail("RESET_VERIFY_FAILED", "Reservation data was not cleared");
  if (verification.store.users.length !== 1 || verification.store.users[0].username !== "admin") fail("RESET_VERIFY_FAILED", "OWNER retention failed");
  if (verification.store.products.length !== 5 || verification.store.products.some(product => product.stockQuantity !== 0)) {
    fail("RESET_VERIFY_FAILED", "Product reset failed");
  }

  process.stdout.write(JSON.stringify({
    status: "COMPLETE",
    archiveRoot,
    archiveManifestSha256: sha256(manifestFile),
    before,
    after: {
      ownerAccounts: verification.store.users.length,
      products: verification.store.products.length,
      stockQuantity: 0,
      reservations: verification.reservations.length,
      reservationDeposits: verification.deposits.length,
      auditLogs: verification.store.auditLogs.length,
      backups: fs.readdirSync(backupRoot).length
    },
    hardwareRecordsChanged: false
  }, null, 2));
}

try { main(); } catch (error) {
  process.stderr.write(JSON.stringify({ status: "FAILED", code: error.code || "RESET_FAILED", message: error.message }, null, 2));
  process.exitCode = 1;
}
