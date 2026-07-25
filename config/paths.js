const os = require("os");
const path = require("path");
const fs = require("fs");

const PRODUCT_DATA_FOLDER = "Lucky Snooker Manager";
function resolveUserDataRoot(environment = process.env) {
  if (environment.LUCKY_USER_DATA_DIR) return path.resolve(environment.LUCKY_USER_DATA_DIR);
  const appData = environment.LOCALAPPDATA || environment.APPDATA || path.join(os.homedir(), ".local", "share");
  return path.join(appData, PRODUCT_DATA_FOLDER);
}
function userDataPaths(environment = process.env) {
  const root = resolveUserDataRoot(environment);
  return { root, database: path.join(root, "database"), backups: path.join(root, "backups"), config: path.join(root, "config"), license: path.join(root, "license"), logs: path.join(root, "logs"), uploads: path.join(root, "uploads"), staging: path.join(root, "update-staging") };
}
function ensureUserDataDirectories(environment = process.env) { const paths = userDataPaths(environment); Object.values(paths).forEach(directory => fs.mkdirSync(directory, { recursive: true })); return paths; }
module.exports = { PRODUCT_DATA_FOLDER, resolveUserDataRoot, userDataPaths, ensureUserDataDirectories };
