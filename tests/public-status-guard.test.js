const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { tunnelGuard, rateLimiter, ttlCache } = require("../infrastructure/public-status-guard");

// The shop shows /status.html to customers on the internet through a Cloudflare Tunnel. These cover the
// three protections that make that safe for a PC that also runs the till.

function fakeRes() {
  return { headers: {}, statusCode: 200, body: null, redirected: null,
    set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; },
    type() { return this; }, send(b) { this.body = b; return this; }, json(b) { this.body = b; return this; },
    redirect(c, to) { this.redirected = to; return this; } };
}
const req = (extra = {}) => ({ method: "GET", path: "/api/public/tables", headers: {}, socket: { remoteAddress: "::ffff:127.0.0.1" }, ...extra });
function run(mw, r) { const res = fakeRes(); let called = false; mw(r, res, () => { called = true; }); return { res, called }; }

test("the cache computes once per window and again after it expires", () => {
  let clock = 0, computed = 0;
  const cache = ttlCache({ ttlMs: 5000, now: () => clock });
  const compute = () => ++computed;
  assert.equal(cache(compute), 1); assert.equal(cache(compute), 1);
  clock = 4999; assert.equal(cache(compute), 1);
  clock = 5000; assert.equal(cache(compute), 2);
});

test("the limiter allows the limit, then answers 429 with Retry-After, per client, and resets next window", () => {
  let clock = 0;
  const limiter = rateLimiter({ limit: 3, windowMs: 60000, now: () => clock });
  const a = () => req({ headers: { "cf-connecting-ip": "1.1.1.1" } });
  const b = () => req({ headers: { "cf-connecting-ip": "2.2.2.2" } });
  for (let i = 0; i < 3; i += 1) assert.equal(run(limiter, a()).called, true);
  const blocked = run(limiter, a());
  assert.equal(blocked.called, false); assert.equal(blocked.res.statusCode, 429); assert.ok(Number(blocked.res.headers["Retry-After"]) >= 1);
  assert.equal(run(limiter, b()).called, true, "one noisy client must not lock out the others");
  clock = 60000;
  assert.equal(run(limiter, a()).called, true);
});

test("a cf-connecting-ip header only counts when the connection really comes from this PC", () => {
  const limiter = rateLimiter({ limit: 1, windowMs: 60000 });
  const lan = ip => req({ socket: { remoteAddress: "192.168.1.50" }, headers: { "cf-connecting-ip": ip } });
  assert.equal(run(limiter, lan("9.9.9.1")).called, true);
  assert.equal(run(limiter, lan("9.9.9.2")).called, false, "a LAN client cannot dodge the limit by forging the header");
});

test("through the tunnel only the public page is reachable; ordinary traffic is untouched", () => {
  const guard = tunnelGuard();
  const tunneled = (p, method = "GET") => req({ path: p, method, headers: { "cf-ray": "abc" } });
  assert.equal(run(guard, tunneled("/status.html")).called, true);
  assert.equal(run(guard, tunneled("/api/public/tables")).called, true);
  assert.equal(run(guard, tunneled("/")).res.redirected, "/status.html");
  for (const p of ["/index.html", "/api/state", "/api/auth/login", "/js/app.js", "/api/hardware/discovery/start"]) {
    const out = run(guard, tunneled(p)); assert.equal(out.called, false, p); assert.equal(out.res.statusCode, 404, p);
  }
  assert.equal(run(guard, tunneled("/api/public/tables", "POST")).called, false);
  assert.equal(run(guard, req({ path: "/api/state" })).called, true, "no tunnel header: the staff app works as before");
  assert.equal(run(guard, req({ path: "/api/state", socket: { remoteAddress: "192.168.1.50" }, headers: { "cf-ray": "x" } })).called, true, "forged header from the LAN is not a tunnel request");
});

test("end to end: the real server serves the page via the tunnel but hides the app, and rate limits", async () => {
  const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-pubguard-"));
  const port = 38000 + Math.floor(Math.random() * 900), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
  try {
    for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${base}/api/state`)).status === 401) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const tunnel = { "cf-connecting-ip": "8.8.4.4", "cf-ray": "r" };
    assert.equal((await fetch(`${base}/status.html`, { headers: tunnel })).status, 200);
    assert.equal((await fetch(`${base}/api/state`, { headers: tunnel })).status, 404, "must be 404, not even the login 401");
    assert.equal((await fetch(`${base}/index.html`, { headers: tunnel })).status, 404);
    assert.equal((await fetch(`${base}/api/state`)).status, 401, "local staff access is unchanged");
    let last;
    for (let i = 0; i < 31; i += 1) last = await fetch(`${base}/api/public/tables`, { headers: tunnel });
    assert.equal(last.status, 429);
    assert.equal((await fetch(`${base}/api/public/tables`, { headers: { ...tunnel, "cf-connecting-ip": "8.8.8.8" } })).status, 200, "another visitor is unaffected");
  } finally { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
