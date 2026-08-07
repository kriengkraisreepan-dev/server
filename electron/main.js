const fs = require("fs");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { app, BrowserWindow, dialog, ipcMain, session, screen } = require("electron");
const { atomicWriteJson } = require("../infrastructure/safe-json-file");
const { validateDataRoot, prepareDataLayout, isWithin } = require("../infrastructure/trusted-data-root");
const { LegacyDataHandoffService } = require("../services/legacy-data-handoff-service");
const { BackendSupervisor } = require("./backend-supervisor");
const { BackupExportService } = require("../services/backup-export-service");
const { IPC_CHANNELS, WINDOW_SECURITY, trustedOrigin, validateSender, contentSecurityPolicy, isAllowedNavigation } = require("./security-policy");

const programRoot = path.resolve(__dirname, "..");
const development = !app.isPackaged;
const internalTestPackage = fs.existsSync(path.join(path.dirname(process.execPath), "INTERNAL_TEST_ONLY"));
if (internalTestPackage) process.env.LUCKY_INTERNAL_TEST = "1";
if (development && !process.env.LUCKY_ELECTRON_TEST_DATA_ROOT) {
  process.env.LUCKY_ELECTRON_TEST_DATA_ROOT = path.join(programRoot, "runtime", "electron-test-user-data", `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  process.env.LUCKY_ALLOW_WORKSPACE_TEST_ROOT = "1";
}
if (internalTestPackage) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !path.isAbsolute(localAppData) || /^\\\\/.test(localAppData)) throw Object.assign(new Error("LOCALAPPDATA is unavailable or unsafe"), { code: "LOCAL_APP_DATA_INVALID" });
  app.setPath("userData", path.join(localAppData, "Lucky Snooker Manager Internal Test"));
} else if (process.env.LUCKY_ELECTRON_TEST_DATA_ROOT) {
  app.setPath("userData", path.resolve(process.env.LUCKY_ELECTRON_TEST_DATA_ROOT));
} else {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !path.isAbsolute(localAppData) || /^\\\\/.test(localAppData)) throw Object.assign(new Error("LOCALAPPDATA is unavailable or unsafe"), { code: "LOCAL_APP_DATA_INVALID" });
  app.setPath("userData", path.join(localAppData, "Lucky Snooker Manager"));
}

let mainWindow = null;
let supervisor = null;
let quitting = false;
let runtimeMarkerFile = null;
const gotLock = app.requestSingleInstanceLock({ owner: "Lucky Snooker Manager", schemaVersion: 1 });
if (!gotLock) app.quit();
app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });

function reserveLoopbackPort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.unref(); server.on("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); }); }); }
function safeBounds(layout) { const file = path.join(layout.config, "window-state.json"); let value = null; try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch {} const fallback = { width: 1280, height: 800 }; if (!value || !["x", "y", "width", "height"].every(key => Number.isInteger(value[key])) || value.width < 1100 || value.height < 700) return fallback; const visible = screen.getAllDisplays().some(display => { const area = display.workArea; return value.x < area.x + area.width && value.x + value.width > area.x && value.y < area.y + area.height && value.y + value.height > area.y; }); return visible ? value : fallback; }
function saveBounds(layout) { if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) return; atomicWriteJson(path.join(layout.config, "window-state.json"), mainWindow.getBounds()); }
function installIpc(origin, layout) {
  const guard = handler => (event, ...args) => { if (!validateSender(event, origin) || args.length) throw Object.assign(new Error("IPC request rejected"), { code: "IPC_REQUEST_REJECTED" }); return handler(); };
  ipcMain.handle(IPC_CHANNELS.APP_INFO, guard(() => ({ name: app.getName(), version: app.getVersion(), mode: development ? "development" : "production-like" })));
  ipcMain.handle(IPC_CHANNELS.RUNTIME_STATUS, guard(() => supervisor?.status() || { state: "STOPPED", backendOwned: false, restartCount: 0 }));
  const exporter = new BackupExportService({ backupDirectory: layout.backups, dataRoot: layout.root });
  ipcMain.handle(IPC_CHANNELS.BACKUP_EXPORT, async (event, request) => {
    if (!validateSender(event, origin) || !request || Object.keys(request).length !== 1 || typeof request.fileName !== "string") throw Object.assign(new Error("IPC request rejected"), { code: "IPC_REQUEST_REJECTED" });
    const source = exporter.inspect(request.fileName);
    const choice = await dialog.showSaveDialog(mainWindow, { title: "บันทึกไฟล์สำรองข้อมูล", defaultPath: source.name, filters: [{ name: "ไฟล์สำรองข้อมูล JSON", extensions: ["json"] }], properties: ["showOverwriteConfirmation", "createDirectory"] });
    if (choice.canceled || !choice.filePath) return { status: "CANCELLED", message: "ยกเลิกการบันทึกไฟล์สำรองข้อมูลแล้ว" };
    return { ...exporter.export(request.fileName, choice.filePath), message: "บันทึกไฟล์สำรองข้อมูลสำเร็จ" };
  });
}
function installSessionPolicy(origin) {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let sameOrigin = false;
    try { sameOrigin = new URL(details.url).origin === origin; } catch {}
    callback({ responseHeaders: sameOrigin ? { ...details.responseHeaders, "Content-Security-Policy": [contentSecurityPolicy(origin)] } : details.responseHeaders });
  });
}
function createWindow(layout, origin) {
  mainWindow = new BrowserWindow({ ...safeBounds(layout), title: internalTestPackage ? "INTERNAL TEST — NOT FOR PRODUCTION" : "Lucky Snooker Manager", minWidth: 1100, minHeight: 700, show: false, backgroundColor: "#0b1120", webPreferences: { ...WINDOW_SECURITY, preload: path.resolve(__dirname, "preload.js"), devTools: development } });
  mainWindow.webContents.on("will-navigate", (event, url) => { if (!isAllowedNavigation(url, origin)) event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => url === "about:blank" ? { action: "allow", overrideBrowserWindowOptions: { webPreferences: { ...WINDOW_SECURITY, preload: undefined, devTools: false } } } : { action: "deny" });
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());
  mainWindow.on("close", event => { if (!quitting) { event.preventDefault(); app.quit(); } });
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(origin).then(() => mainWindow?.show());
}
async function resolveLayoutAndMigration() {
  const raw = app.getPath("userData");
  const allowWorkspaceTestRoot = development && process.env.LUCKY_ALLOW_WORKSPACE_TEST_ROOT === "1";
  const canonical = validateDataRoot(raw, { programRoot, workspaceRoot: programRoot, allowWorkspaceTestRoot });
  if (isWithin(programRoot, canonical) && !allowWorkspaceTestRoot) throw Object.assign(new Error("Customer Data อยู่ภายใน Program directory"), { code: "DATA_ROOT_PROGRAM_CONFLICT" });
  const handoff = new LegacyDataHandoffService({ sourceRoot: path.join(programRoot, "data"), destinationRoot: canonical, applicationVersion: app.getVersion() });
  const state = handoff.detect();
  if (state.status === "LEGACY_DATA_AVAILABLE") {
    const answer = await dialog.showMessageBox({ type: "question", buttons: ["คัดลอกข้อมูลเดิมอย่างปลอดภัย", "ยกเลิก"], defaultId: 1, cancelId: 1, title: "พบข้อมูล Lucky Snooker Manager เดิม", message: "พบข้อมูลเดิมใน Program directory", detail: "ระบบจะคัดลอกและตรวจสอบข้อมูล โดยไม่ลบต้นฉบับ" });
    if (answer.response !== 0) throw Object.assign(new Error("ผู้ใช้ยังไม่อนุมัติการส่งต่อข้อมูลเดิม"), { code: "LEGACY_HANDOFF_NOT_CONFIRMED" });
    handoff.migrate();
  } else if (["LEGACY_DATA_INVALID", "LEGACY_DATA_AMBIGUOUS"].includes(state.status)) {
    throw Object.assign(new Error("ข้อมูลเดิมไม่พร้อมสำหรับการส่งต่ออัตโนมัติ"), { code: state.status });
  } else if (state.status === "MIGRATION_INCOMPLETE") handoff.migrate();
  return prepareDataLayout(canonical, { programRoot, workspaceRoot: programRoot, allowWorkspaceTestRoot });
}
function createRuntimeMarker(layout, port) {
  runtimeMarkerFile = path.join(layout.runtime, "desktop-runtime.json");
  if (fs.existsSync(runtimeMarkerFile)) {
    const old = (() => { try { return JSON.parse(fs.readFileSync(runtimeMarkerFile, "utf8")); } catch { return null; } })();
    if (!old || !Number.isInteger(old.pid)) throw Object.assign(new Error("พบ runtime marker ที่ไม่ปลอดภัย"), { code: "RUNTIME_MARKER_INVALID" });
  }
  atomicWriteJson(runtimeMarkerFile, { schemaVersion: 1, pid: process.pid, port, instanceId: crypto.randomUUID(), startedAt: new Date().toISOString() }, { keepBackup: false });
}
function removeRuntimeMarker() { if (!runtimeMarkerFile) return; try { fs.unlinkSync(runtimeMarkerFile); } catch {} runtimeMarkerFile = null; }
async function boot() {
  const layout = await resolveLayoutAndMigration();
  const port = await reserveLoopbackPort();
  const origin = trustedOrigin(port);
  createRuntimeMarker(layout, port);
  installSessionPolicy(origin); installIpc(origin, layout);
  supervisor = new BackendSupervisor({ entry: path.join(programRoot, "index.js"), programRoot, dataRoot: layout.root, port, logFile: path.join(layout.logs, "desktop-backend.log") });
  supervisor.onCrash = async () => { if (quitting) return; if (!supervisor.canRestart()) return dialog.showErrorBox("Backend หยุดทำงาน", "ระบบหยุดการเริ่มใหม่อัตโนมัติหลังล้มเหลว 3 ครั้งใน 5 นาที กรุณาปิดโปรแกรมและตรวจ logs"); try { supervisor.launch(); await supervisor.waitUntilReady(); mainWindow?.reload(); } catch { dialog.showErrorBox("เริ่ม Backend ไม่สำเร็จ", "กรุณาปิดโปรแกรมและตรวจสอบโฟลเดอร์ logs"); } };
  supervisor.launch(); await supervisor.waitUntilReady(); createWindow(layout, origin);
  app.on("before-quit", event => { if (quitting) return; event.preventDefault(); quitting = true; saveBounds(layout); supervisor.stop(10000).finally(() => { removeRuntimeMarker(); app.quit(); }); });
}
if (gotLock) app.whenReady().then(boot).catch(error => { removeRuntimeMarker(); dialog.showErrorBox("เปิด Lucky Snooker Manager ไม่สำเร็จ", `${error.code || "STARTUP_FAILED"}\nกรุณาตรวจสอบ Customer Data และ logs`); app.quit(); });
app.on("window-all-closed", () => app.quit());

module.exports = { reserveLoopbackPort, safeBounds };
