const fs = require("fs");
const path = require("path");

function resolveDevelopmentFirmwarePackage({ workspaceRoot, environment = process.env } = {}) {
  if (environment.LUCKY_FLASHER_PACKAGE_ROOT) {
    return {
      packageRoot: environment.LUCKY_FLASHER_PACKAGE_ROOT,
      publicKey: environment.LUCKY_FIRMWARE_PUBLIC_KEY || "",
      mode: environment.LUCKY_FLASHER_PACKAGE_MODE || "test"
    };
  }

  const root = path.resolve(workspaceRoot || path.join(__dirname, ".."));
  const bundledRoot = path.join(root, "resources", "firmware", "internal-test");
  const bundledKey = path.join(bundledRoot, "internal-test-public.pem");
  // Note: deliberately NOT gated on LUCKY_INTERNAL_TEST here. That flag also controls whether
  // electron/main.js switches to a separate "Internal Test" userData folder (see the
  // INTERNAL_TEST_ONLY marker file check there) — a real production install never sets it, but
  // still ships this bundled internal-test-signed firmware package (there is no separate
  // production-signed package; Phase 5.3 production signing is shelved, see
  // project-scope-and-decisions memory). Gating firmware-package discovery on the same flag as
  // data-folder isolation meant a normal installed app could never find its own bundled firmware
  // package. Existence of the manifest+key on disk is itself the trust boundary here.
  if (fs.existsSync(path.join(bundledRoot, "manifest.json")) && fs.existsSync(bundledKey)) {
    return { packageRoot: bundledRoot, publicKey: fs.readFileSync(bundledKey, "utf8"), mode: "internal-test" };
  }
  if (environment.NODE_ENV === "production" || !fs.existsSync(path.join(root, ".git"))) {
    return { packageRoot: undefined, publicKey: environment.LUCKY_FIRMWARE_PUBLIC_KEY || "", mode: "test" };
  }

  const packagesRoot = path.join(root, "runtime", "firmware-packages", "test");
  const keysRoot = path.join(packagesRoot, ".test-keys");
  let candidates = [];
  try {
    candidates = fs.readdirSync(packagesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
      .map(entry => {
        const packageRoot = path.join(packagesRoot, entry.name);
        const manifestPath = path.join(packageRoot, "manifest.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const publicKeyPath = path.join(keysRoot, `${manifest.buildId}.public.pem`);
        if (manifest.releaseChannel !== "test" || manifest.signingEnvironment !== "test") return null;
        if (!fs.existsSync(publicKeyPath)) return null;
        return { packageRoot, publicKeyPath, modifiedMs: fs.statSync(manifestPath).mtimeMs };
      })
      .filter(Boolean)
      .sort((left, right) => right.modifiedMs - left.modifiedMs);
  } catch {
    return { packageRoot: undefined, publicKey: environment.LUCKY_FIRMWARE_PUBLIC_KEY || "", mode: "test" };
  }

  if (!candidates.length) return { packageRoot: undefined, publicKey: environment.LUCKY_FIRMWARE_PUBLIC_KEY || "", mode: "test" };
  return {
    packageRoot: candidates[0].packageRoot,
    publicKey: fs.readFileSync(candidates[0].publicKeyPath, "utf8"),
    mode: "test"
  };
}

module.exports = { resolveDevelopmentFirmwarePackage };
