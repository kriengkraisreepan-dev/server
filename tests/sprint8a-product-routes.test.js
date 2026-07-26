const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-sprint8a-"));
const port = 33000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}`;

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`${base}/api/products`); if (response.status === 401) return; }
    catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Test server did not start");
}
async function json(response) { assert.match(response.headers.get("content-type") || "", /application\/json/); return response.json(); }

(async () => {
  try {
    await waitForServer();
    let response = await fetch(`${base}/api/products?pageSize=100`);
    assert.strictEqual(response.status, 401);
    assert.ok((await json(response)).error);

    response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "123456789" }) });
    assert.strictEqual(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie, "owner login must issue a session cookie");
    const headers = { Cookie: cookie.split(";")[0] };

    response = await fetch(`${base}/api/products?pageSize=100`, { headers });
    assert.strictEqual(response.status, 200);
    const products = await json(response);
    assert.ok(Array.isArray(products.items));
    assert.deepStrictEqual(products.pagination, { page: 1, pageSize: 100, total: 3, totalPages: 1 });

    response = await fetch(`${base}/api/product-categories`, { headers });
    assert.strictEqual(response.status, 200);
    const categories = await json(response);
    assert.ok(Array.isArray(categories.items));
    assert.strictEqual(categories.items.length, 5);

    response = await fetch(`${base}/api/unknown-route`, { headers });
    assert.strictEqual(response.status, 404);
    const notFound = await json(response);
    assert.strictEqual(notFound.error, "API route not found");
    console.log("Sprint 8A product route regression tests passed");
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
