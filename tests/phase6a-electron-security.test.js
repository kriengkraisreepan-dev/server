const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { IPC_CHANNELS, WINDOW_SECURITY, trustedOrigin, validateSender, contentSecurityPolicy, isAllowedNavigation } = require("../electron/security-policy");

const root = path.resolve(__dirname, "..");
test("Electron BrowserWindow security baseline is locked", () => {
  assert.deepEqual(WINDOW_SECURITY, { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false });
  const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
  assert.match(main, /preload:\s*path\.resolve\(__dirname, "preload\.js"\)/);
  assert.doesNotMatch(main, /enableRemoteModule|webSecurity:\s*false|certificate-error/);
});

test("preload exposes fixed allowlisted operations and no generic IPC", () => {
  const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");
  assert.deepEqual(Object.keys(IPC_CHANNELS).sort(), ["APP_INFO", "BACKUP_EXPORT", "RUNTIME_STATUS"]);
  assert.match(preload, /getAppInfo/); assert.match(preload, /getRuntimeStatus/);
  assert.doesNotMatch(preload, /ipcRenderer\.(send|on)|\brequire\(["'](?:fs|path|child_process)["']\)|process\.env/);
});

test("sender, navigation, and CSP are fail closed", () => {
  const origin = trustedOrigin(32123);
  assert.equal(validateSender({ senderFrame: { url: `${origin}/hardware` } }, origin), true);
  assert.equal(validateSender({ senderFrame: { url: "https://example.com/" } }, origin), false);
  assert.equal(isAllowedNavigation(`${origin}/reports`, origin), true);
  assert.equal(isAllowedNavigation("https://example.com", origin), false);
  assert.equal(isAllowedNavigation("not a url", origin), false);
  const csp = contentSecurityPolicy(origin);
  assert.match(csp, /default-src 'self'/); assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval|https?:\/\/(?!127\.0\.0\.1)/);
});

test("renderer cannot choose paths, processes, ports, or IPC options", () => {
  const preload = fs.readFileSync(path.join(root, "electron", "preload.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
  assert.doesNotMatch(preload, /filesystem|executable|command|Device Key|Setup Code|sourcePath|destinationPath/);
  assert.match(main, /if \(!validateSender\(event, origin\) \|\| args\.length\)/);
  assert.match(main, /url === "about:blank"/);
  assert.match(main, /action: "deny"/);
});

test("production-like mode disables DevTools and renderer contains no eval", () => {
  const main = fs.readFileSync(path.join(root, "electron", "main.js"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "public", "js", "app.js"), "utf8");
  assert.match(main, /devTools: development/);
  assert.doesNotMatch(renderer, /\beval\s*\(|new Function\s*\(/);
});
