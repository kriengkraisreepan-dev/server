const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const electronPackage = require(path.join(root, "node_modules", "electron", "package.json"));
const electronExecutable = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
if (!fs.existsSync(electronExecutable)) throw Object.assign(new Error("Electron binary is missing"), { code: "ELECTRON_BINARY_MISSING" });
const hash = crypto.createHash("sha256").update(fs.readFileSync(electronExecutable)).digest("hex");
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const locked = packageLock.packages?.["node_modules/electron"];
const inventory = {
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  nodeRuntime: process.version,
  electron: { version: electronPackage.version, license: electronPackage.license, exactPin: require(path.join(root, "package.json")).devDependencies.electron, registryIntegrity: locked?.integrity || null, binarySha256: hash, binaryBytes: fs.statSync(electronExecutable).size },
  packagingTool: null,
  installerCreated: false
};
process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
