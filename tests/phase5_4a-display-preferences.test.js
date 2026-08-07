const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const { DisplayPreferencesService, THEME_KEY, SCALE_KEY } = require("../public/js/display-preferences.js");

function harness(values = {}, dark = true) {
  const data = new Map(Object.entries(values));
  const listeners = [];
  const storage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key)
  };
  const query = { matches: dark, addEventListener: (name, callback) => listeners.push(callback) };
  const rootElement = { dataset: {} };
  const service = new DisplayPreferencesService({ root: rootElement, storage, matchMedia: () => query });
  service.read(); service.subscribeToSystemTheme(); service.apply();
  return { service, data, rootElement, query, listeners };
}

test("defaults, valid storage and invalid values use strict allowlists", () => {
  const defaults = harness();
  assert.equal(defaults.service.theme, "dark");
  assert.equal(defaults.service.scale, "normal");
  const valid = harness({ [THEME_KEY]: "light", [SCALE_KEY]: "xlarge" });
  assert.equal(valid.rootElement.dataset.resolvedTheme, "light");
  assert.equal(valid.rootElement.dataset.uiScale, "xlarge");
  const invalid = harness({ [THEME_KEY]: "url(evil)", [SCALE_KEY]: "999%" });
  assert.equal(invalid.service.theme, "dark");
  assert.equal(invalid.service.scale, "normal");
  assert.equal(invalid.service.updateTheme("custom"), false);
  assert.equal(invalid.service.updateScale("200%"), false);
});

test("storage exceptions fail safely while in-session changes still apply", () => {
  const rootElement = { dataset: {} };
  const broken = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  const service = new DisplayPreferencesService({ root: rootElement, storage: broken, matchMedia: () => ({ matches: false }) });
  assert.doesNotThrow(() => service.read());
  assert.equal(service.updateTheme("light"), false);
  assert.equal(rootElement.dataset.resolvedTheme, "light");
  assert.equal(service.updateScale("large"), false);
  assert.equal(rootElement.dataset.uiScale, "large");
});

test("system theme follows live changes and listener is attached only once", () => {
  const h = harness({ [THEME_KEY]: "system" }, true);
  assert.equal(h.rootElement.dataset.resolvedTheme, "dark");
  assert.equal(h.service.subscribeToSystemTheme(), false);
  assert.equal(h.listeners.length, 1);
  h.query.matches = false;
  h.listeners[0]();
  assert.equal(h.rootElement.dataset.resolvedTheme, "light");
});

test("updates persist immediately and refresh reads them", () => {
  const h = harness();
  assert.equal(h.service.updateTheme("system"), true);
  assert.equal(h.service.updateScale("small"), true);
  const refreshed = harness(Object.fromEntries(h.data), false);
  assert.equal(refreshed.service.theme, "system");
  assert.equal(refreshed.rootElement.dataset.resolvedTheme, "light");
  assert.equal(refreshed.service.scale, "small");
});

test("reset removes only display keys", () => {
  const h = harness({ [THEME_KEY]: "light", [SCALE_KEY]: "large", authToken: "keep", lucky_pos_context_user: "keep" });
  h.service.reset();
  assert.equal(h.data.has(THEME_KEY), false);
  assert.equal(h.data.has(SCALE_KEY), false);
  assert.equal(h.data.get("authToken"), "keep");
  assert.equal(h.data.get("lucky_pos_context_user"), "keep");
});

test("UI integration is browser-only and display values never enter API settings payload", () => {
  const app = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, /js\/display-preferences\.js[\s\S]*css\/style\.css/);
  assert.match(app, /การตั้งค่านี้มีผลเฉพาะ Browser และคอมพิวเตอร์เครื่องนี้/);
  assert.doesNotMatch(app, /JSON\.stringify\([^)]*displayTheme|JSON\.stringify\([^)]*displayScale/);
  assert.doesNotMatch(app, /innerHTML\s*=\s*localStorage/);
  assert.doesNotMatch(app, /eval\s*\(/);
});

test("CSS scales the complete application layout, bounds modals, permits table overflow and isolates print", () => {
  const css = fs.readFileSync(path.join(root, "public/css/display-preferences.css"), "utf8");
  assert.match(css, /\.dialog\{[^}]*max-height:[^}]*overflow:auto/);
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /@media print/);
  assert.match(css, /--ui-scale:1/);
  assert.match(css, /html\{font-size:100%;zoom:var\(--ui-scale\)\}/);
  assert.match(css, /@media print[\s\S]*html\{zoom:1\}/);
  assert.doesNotMatch(css, /font-size:calc\(100% \* var\(--ui-scale\)\)/);
  assert.doesNotMatch(css, /transform\s*:\s*scale\(/);
});

test("Phase 5.4A does not modify Captive Portal, Firmware, dependencies or backend APIs", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies?.jsdom, undefined);
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.doesNotMatch(html, /captive|192\.168\.4\.1/i);
  const service = fs.readFileSync(path.join(root, "public/js/display-preferences.js"), "utf8");
  assert.doesNotMatch(service, /fetch\s*\(|XMLHttpRequest|\/api\//);
});
