const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-sprint10d-health-"));
const port = 38000 + Math.floor(Math.random() * 1000);
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
    response = await fetch(`${base}/api/backups`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
    assert.strictEqual(response.status, 201);
    const backup = await response.json();
    assert.strictEqual(backup.verificationStatus, "VERIFIED");
    assert.strictEqual(backup.fileCount, 3);
    assert.ok(backup.checksum);

    response = await fetch(`${base}/api/backups/${encodeURIComponent(backup.file)}/dry-run`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
    assert.strictEqual(response.status, 200);
    const dryRun = await response.json();
    assert.strictEqual(dryRun.status, "RESTORABLE");

    response = await fetch(`${base}/api/health`, { headers: { Cookie: cookie } });
    assert.strictEqual(response.status, 200);
    const health = await response.json();
    assert.ok(["HEALTHY","WARNING"].includes(health.status));
    assert.strictEqual(health.server, "RUNNING");
    assert.strictEqual(health.jsonFiles.length, 3);
    assert.ok(health.memoryUsage.rss > 0);
    assert.ok(!JSON.stringify(health).includes("passwordHash"));
    console.log("Sprint 10D health and verified backup integration test passed");
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
