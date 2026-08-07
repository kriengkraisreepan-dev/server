const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const electron = require("electron");
const workspace = path.resolve(__dirname, "..");
const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const dataRoot = path.join(workspace, "runtime", "electron-test-user-data", runId);
const child = spawn(electron, [path.join(workspace, "electron", "main.js")], { cwd: workspace, windowsHide: false, stdio: "inherit", env: { ...process.env, LUCKY_ELECTRON_TEST_DATA_ROOT: dataRoot, LUCKY_ALLOW_WORKSPACE_TEST_ROOT: "1" } });
child.once("exit", code => { process.exitCode = code || 0; });
