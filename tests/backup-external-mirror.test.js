const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-backup-mirror-data-"));
const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-backup-mirror-external-"));
const port = 39000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).status === 401) return; } catch {}
    await pause(100);
  }
  throw new Error("Test server did not start");
}

(async () => {
  try {
    await waitForServer();
    let response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
    assert.strictEqual(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const authed = { Cookie: cookie, "Content-Type": "application/json" };

    // Owner configures an external default backup location (e.g. an attached USB drive).
    response = await fetch(`${base}/api/settings`, { method: "PUT", headers: authed, body: JSON.stringify({ tableCount: 1, hourlyRate: 100, minimumCharge: 0, backupExternalPath: externalDir }) });
    assert.strictEqual(response.status, 200, await response.text());

    response = await fetch(`${base}/api/backups`, { method: "POST", headers: authed, body: "{}" });
    assert.strictEqual(response.status, 201);
    const backup = await response.json();
    assert.strictEqual(backup.verificationStatus, "VERIFIED", "local backup must still succeed and verify");

    const mirrored = path.join(externalDir, backup.file);
    assert.ok(fs.existsSync(mirrored), "backup file must be mirrored into the external folder");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(mirrored, "utf8")), JSON.parse(fs.readFileSync(path.join(dataDir, "backups", backup.file), "utf8")), "mirrored copy must match the local backup byte-for-byte");

    response = await fetch(`${base}/api/health`, { headers: { Cookie: cookie } });
    const health = await response.json();
    assert.strictEqual(health.backup.externalBackup.status, "VERIFIED");
    assert.strictEqual(path.resolve(health.backup.externalBackup.path), path.resolve(externalDir));

    // Point at an unreachable location (a file, not a directory) -- local backup must still
    // succeed; only the external mirror should report a problem, surfaced as a WARNING (not
    // CRITICAL) so staff notice without the whole health check failing closed.
    const blockedPath = path.join(os.tmpdir(), `lucky-backup-mirror-blocked-${Date.now()}`);
    fs.writeFileSync(blockedPath, "not a directory");
    response = await fetch(`${base}/api/settings`, { method: "PUT", headers: authed, body: JSON.stringify({ tableCount: 1, hourlyRate: 100, minimumCharge: 0, backupExternalPath: blockedPath }) });
    assert.strictEqual(response.status, 200);

    response = await fetch(`${base}/api/backups`, { method: "POST", headers: authed, body: "{}" });
    assert.strictEqual(response.status, 201, "local backup must succeed even when the external mirror target is unreachable");
    const secondBackup = await response.json();
    assert.strictEqual(secondBackup.verificationStatus, "VERIFIED");

    response = await fetch(`${base}/api/health`, { headers: { Cookie: cookie } });
    const secondHealth = await response.json();
    assert.strictEqual(secondHealth.backup.externalBackup.status, "UNREACHABLE");
    assert.strictEqual(secondHealth.status, "WARNING");
    assert.notStrictEqual(secondHealth.status, "CRITICAL");

    fs.rmSync(blockedPath, { force: true });

    // Clearing the path disables mirroring entirely without touching local backups.
    response = await fetch(`${base}/api/settings`, { method: "PUT", headers: authed, body: JSON.stringify({ tableCount: 1, hourlyRate: 100, minimumCharge: 0, backupExternalPath: "" }) });
    assert.strictEqual(response.status, 200);
    response = await fetch(`${base}/api/backups`, { method: "POST", headers: authed, body: "{}" });
    assert.strictEqual(response.status, 201);
    response = await fetch(`${base}/api/health`, { headers: { Cookie: cookie } });
    const thirdHealth = await response.json();
    assert.strictEqual(thirdHealth.backup.externalBackup, null);

    console.log("Backup external mirror test passed");
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
