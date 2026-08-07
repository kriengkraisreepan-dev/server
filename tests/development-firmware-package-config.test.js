const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveDevelopmentFirmwarePackage } = require("../services/development-firmware-package-config");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-firmware-config-"));
  fs.mkdirSync(path.join(root, ".git"));
  const packageRoot = path.join(root, "runtime", "firmware-packages", "test", "1.1.0");
  const keysRoot = path.join(root, "runtime", "firmware-packages", "test", ".test-keys");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(keysRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "manifest.json"), JSON.stringify({
    buildId: "test-current", releaseChannel: "test", signingEnvironment: "test"
  }));
  fs.writeFileSync(path.join(keysRoot, "test-current.public.pem"), "PUBLIC TEST KEY");
  return { root, packageRoot };
}

test("development workspace resolves the newest signed test package and matching public key", () => {
  const value = fixture();
  const resolved = resolveDevelopmentFirmwarePackage({ workspaceRoot: value.root, environment: {} });
  assert.equal(resolved.packageRoot, value.packageRoot);
  assert.equal(resolved.publicKey, "PUBLIC TEST KEY");
});

test("explicit package configuration wins over development discovery", () => {
  const value = fixture();
  const resolved = resolveDevelopmentFirmwarePackage({
    workspaceRoot: value.root,
    environment: { LUCKY_FLASHER_PACKAGE_ROOT: "D:\\approved", LUCKY_FIRMWARE_PUBLIC_KEY: "EXPLICIT" }
  });
  assert.deepEqual(resolved, { packageRoot: "D:\\approved", publicKey: "EXPLICIT", mode: "test" });
});

test("production and installed copies never auto-trust workspace test keys", () => {
  const value = fixture();
  assert.equal(resolveDevelopmentFirmwarePackage({ workspaceRoot: value.root, environment: { NODE_ENV: "production" } }).packageRoot, undefined);
  fs.rmSync(path.join(value.root, ".git"), { recursive: true });
  assert.equal(resolveDevelopmentFirmwarePackage({ workspaceRoot: value.root, environment: {} }).packageRoot, undefined);
});
