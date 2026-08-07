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
  if (environment.LUCKY_INTERNAL_TEST === "1" && fs.existsSync(path.join(bundledRoot, "manifest.json")) && fs.existsSync(bundledKey)) {
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
