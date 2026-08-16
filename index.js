const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { JsonSettingsRepository } = require("./repositories/json-settings-repository");
const { JsonSessionRepository } = require("./repositories/json-session-repository");
const { SettingsService } = require("./services/settings-service");
const { TableSessionService } = require("./services/table-session-service");
const { JsonBillingRepository } = require("./repositories/json-billing-repository");
const { BillingService } = require("./services/billing-service");
const { PaymentService } = require("./services/payment-service");
const { BillHistoryService } = require("./services/bill-history-service");
const { AuditLogService } = require("./services/audit-log-service");
const { JsonUserRepository } = require("./repositories/json-user-repository");
const { AuthService } = require("./services/auth-service");
const { JsonInventoryRepository } = require("./repositories/json-inventory-repository");
const { InventoryService } = require("./services/inventory-service");
const { JsonPosOrderRepository } = require("./repositories/json-pos-order-repository");
const { PosOrderService } = require("./services/pos-order-service");
const { CombinedBillingService } = require("./services/combined-billing-service");
const { JsonMemberRepository } = require("./repositories/json-member-repository");
const { MemberService } = require("./services/member-service");
const { ReservationRepository } = require("./repositories/reservation-repository");
const { ReservationDepositRepository } = require("./repositories/reservation-deposit-repository");
const { ReservationService } = require("./services/reservation-service");
const { ReservationDepositService } = require("./services/reservation-deposit-service");
const { DepositSettlementService } = require("./services/deposit-settlement-service");
const { PERMISSIONS, hasPermission } = require("./domain/permissions");
const { bahtToSatang, satangToBaht } = require("./domain/money");
const { atomicWriteJson, readJsonWithRecovery, activeJsonWrites } = require("./infrastructure/safe-json-file");
const { resolveServerDataLayout } = require("./infrastructure/trusted-data-root");
const { IntegrityCheckService } = require("./services/integrity-check-service");
const { RecoveryService } = require("./services/recovery-service");
const { HealthService } = require("./services/health-service");
const { RelayService } = require("./services/relay-service");
const { HardwareRepository } = require("./repositories/hardware-repository");
const { RelayControllerDriver } = require("./drivers/relay-controller-driver");
const { HardwareService } = require("./services/hardware-service");
const { HardwareHealthMonitoringService } = require("./services/hardware-health-monitoring-service");
const { HardwareController } = require("./controllers/hardware-controller");
const { HardwareSetupWizardService } = require("./services/hardware-setup-wizard-service");
const { UdpDiscoveryAdapter, MdnsDiscoveryAdapter } = require("./drivers/hardware-discovery-adapters");
const { HardwareDiscoveryService } = require("./services/hardware-discovery-service");
const { HardwareWifiProvisioningService } = require("./services/hardware-wifi-provisioning-service");
const { HardwareSetupModeService } = require("./services/hardware-setup-mode-service");
const { HardwareWiringAssistantService } = require("./services/hardware-wiring-assistant-service");
const { TableConfigurationService } = require("./services/table-configuration-service");
const { HardwareEnrollmentHandoffService } = require("./services/hardware-enrollment-handoff-service");
const { FirmwarePackageService } = require("./services/firmware-package-service");
const { resolveDevelopmentFirmwarePackage } = require("./services/development-firmware-package-config");
const { UsbFlasherService } = require("./services/usb-flasher-service");
const { UsbFlasherLog } = require("./services/usb-flasher-log");
const { PerDeviceNvsService } = require("./services/per-device-nvs-service");
const { WindowsComPortProvider } = require("./drivers/windows-com-port-provider");
const { WindowsDpapiProtector } = require("./infrastructure/windows-dpapi-protector");
const { HardwareSecretVault } = require("./services/hardware-secret-vault");
const { WindowsSerialRecoveryTransport } = require("./drivers/windows-serial-recovery-transport");
const { HardwareUsbRecoveryService } = require("./services/hardware-usb-recovery-service");
const { HardwareUsbAdoptionService } = require("./services/hardware-usb-adoption-service");
const { PortableMigrationService } = require("./services/portable-migration-service");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.LUCKY_HOST || undefined;
const dataLayout = resolveServerDataLayout();
const dataDir = dataLayout.database;
const dataFile = path.join(dataDir, "store.json");
const backupsDir = dataLayout.backups;
const MAX_BACKUPS = 30;
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Declared here (ahead of settingsService/authService.bootstrap()) because bootstrap can
// trigger the very first save()/backupNow() during module initialization, and
// mirrorBackupExternally() (a hoisted function declaration) would otherwise read this `let`
// before its own initializer line runs further down the file.
let lastExternalBackupStatus = null;
const checksum = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

function seed() {
  return { settings: { shopName: "88 Snooker Club", hourlyRate: 100, minimumCharge: 50, tableCount: 3, promptPayId: "" }, tables: Array.from({ length: 3 }, (_, i) => ({ id: i + 1, code: `T${String(i + 1).padStart(2, "0")}`, name: `โต๊ะ ${i + 1}`, relay: i + 1, status: "free", memberId: null, startTime: null, items: [] })), members: [], products: [{ id: "p-water", name: "น้ำดื่ม", price: 15, category: "เครื่องดื่ม", active: true }, { id: "p-cola", name: "โค้ก", price: 25, category: "เครื่องดื่ม", active: true }, { id: "p-noodle", name: "มาม่า", price: 35, category: "อาหาร", active: true }], bills: [], payments: [] };
}
const validStoreShape = value => value && typeof value === "object" && !Array.isArray(value) && ["settings","tables","members","products","bills","payments"].every(key => key === "settings" ? value.settings && typeof value.settings === "object" : Array.isArray(value[key]));
function load() { return readJsonWithRecovery(dataFile, { validate: validStoreShape, create: seed }).value; }
let store = load();
let reservationRepository, reservationDepositRepository;
function save() { atomicWriteJson(dataFile, store); maybeAutoBackup(); }
const settingsRepository = new JsonSettingsRepository({ getStore: () => store, save });
const settingsService = new SettingsService(settingsRepository);
const sessionRepository = new JsonSessionRepository({ getStore: () => store, save });
const sessionService = new TableSessionService(sessionRepository);
const billingRepository = new JsonBillingRepository({ getStore: () => store, save });
// Unconditional prune at boot (on top of the throttled check inside appendAudit) so entries past
// the retention window are cleared even if the server sat off for a while before this start.
if (billingRepository.pruneAuditLogs() > 0) save();
const billingService = new BillingService(billingRepository);
const memberRepository = new JsonMemberRepository({ getStore: () => store, save });
const memberService = new MemberService(memberRepository,{audit:(event,actor,data)=>billingService.audit(event,{actorId:actor,data})});
memberService.normalize();
// Unconditional sweep at boot (on top of the periodic timer below) so batches that came due while
// the server sat off for a while are still expired promptly. No-op when pointExpiryMonths=0.
if (memberService.sweepAllExpiredPoints(settingsService.getSettings()).length) save();
const paymentService = new PaymentService(billingRepository, billingService);
const billHistoryService = new BillHistoryService(billingRepository);
const auditLogService = new AuditLogService(billingRepository);
const userRepository = new JsonUserRepository({ getStore: () => store, save });
const authService = new AuthService(userRepository, () => new Date(), (event, actorId, targetUserId, details = {}) => billingService.audit(event, { actorId, data: { targetUserId, ...details } }), () => settingsService.getSettings().security);
const inventoryRepository = new JsonInventoryRepository({ getStore: () => store, save });
const inventoryService = new InventoryService(inventoryRepository, { audit: (event, actorId, data) => billingService.audit(event, { actorId, data }) });
inventoryService.normalizeLegacyProducts();
inventoryService.ensureDefaultCategories();
const posOrderRepository = new JsonPosOrderRepository({ getStore: () => store, save });
const posOrderService = new PosOrderService(posOrderRepository, inventoryService, { audit: (event, actorId, data) => billingService.audit(event, { actorId, data }), findTable: tableById, findMember: memberById });
posOrderService.normalizeLegacyPosOrders();
const combinedBillingService = new CombinedBillingService({ sessionRepository, sessionService, posOrderRepository, billingRepository, billingService, inventoryService, getMember: memberById, getMemberName: memberId => memberById(memberId)?.displayName || memberById(memberId)?.name || "ลูกค้าทั่วไป", save });
const hardwareSecretVault = new HardwareSecretVault({ file: path.join(dataLayout.config, "hardware-secrets.dpapi.json"), protector: new WindowsDpapiProtector() });
const hardwareRepository = new HardwareRepository(path.join(dataDir, "hardware-devices.json"), { secretVault: hardwareSecretVault });
const relayControllerDriver = new RelayControllerDriver();
const hardwareService = new HardwareService(hardwareRepository, relayControllerDriver, {
  tables: () => store.tables,
  saveTables: save,
  audit: (event, actorId, data) => billingService.audit(event, { actorId, data })
});
const hardwareController = new HardwareController(hardwareService);
const hardwareHealthMonitoringService = new HardwareHealthMonitoringService({
  repository: hardwareRepository,
  driver: relayControllerDriver,
  audit: (event, actorId, data) => billingService.audit(event, { actorId, data }),
  log: operationalLog,
  enabled: process.env.LUCKY_HARDWARE_HEALTH_POLLING !== "0"
});
const hardwareSetupWizardService = new HardwareSetupWizardService({
  driver: relayControllerDriver,
  hardwareService,
  enabled: () => settingsService.getSettings().hardware.setupWizardEnabled,
  log: operationalLog
});
const hardwareDiscoveryService = new HardwareDiscoveryService({
  repository: hardwareRepository,
  hardwareService,
  driver: new RelayControllerDriver({ timeoutMs: 1500 }),
  mdns: new MdnsDiscoveryAdapter(),
  udp: new UdpDiscoveryAdapter(),
  enabled: () => settingsService.getSettings().hardware.discoveryEnabled,
  log: operationalLog
});
const hardwareWifiProvisioningService = new HardwareWifiProvisioningService({
  hardwareService,
  discoveryService: hardwareDiscoveryService,
  driver: relayControllerDriver,
  enabled: () => settingsService.getSettings().hardware.wifiProvisioningEnabled,
  log: operationalLog
});
const hardwareSetupModeService = new HardwareSetupModeService({
  hardwareService,
  driver: relayControllerDriver,
  enabled: () => settingsService.getSettings().hardware.setupApEnabled,
  audit: (event, actorId, data) => billingService.audit(event, { actorId, data })
});
const usbFlasherLog = new UsbFlasherLog({ directory: path.join(dataLayout.logs, "usb-flasher") });
const developmentFirmwarePackage = resolveDevelopmentFirmwarePackage({ workspaceRoot: __dirname });
const serialRecoveryTransport = new WindowsSerialRecoveryTransport();
const usbFlasherService = new UsbFlasherService({
  packageService: new FirmwarePackageService({
    packageRoot: developmentFirmwarePackage.packageRoot,
    publicKey: developmentFirmwarePackage.publicKey,
    mode: developmentFirmwarePackage.mode
  }),
  portProvider: new WindowsComPortProvider(),
  relaySafe: async () => store.tables.every(table => !["playing", "paused", "awaiting_payment"].includes(table.status)),
  recoveryTransport: serialRecoveryTransport,
  log: (event, details) => usbFlasherLog.write(event, details),
  nvsGenerator: new PerDeviceNvsService()
});
const hardwareEnrollmentHandoffService = new HardwareEnrollmentHandoffService({
  flasher: usbFlasherService, discovery: hardwareDiscoveryService, driver: relayControllerDriver,
  hardwareService, wizardService: hardwareSetupWizardService,
  audit: (event, actorId, data) => billingService.audit(event, { actorId, data })
});
const hardwareUsbRecoveryService = new HardwareUsbRecoveryService({
  hardwareService, repository: hardwareRepository, transport: serialRecoveryTransport,
  portProvider: new WindowsComPortProvider(), discovery: hardwareDiscoveryService,
  audit: (event, actorId, data) => billingService.audit(event, { actorId, data })
});
const hardwareUsbAdoptionService = new HardwareUsbAdoptionService({
  wizardService: hardwareSetupWizardService, hardwareService, repository: hardwareRepository,
  driver: relayControllerDriver, transport: serialRecoveryTransport, portProvider: new WindowsComPortProvider(),
  audit: (event, actorId, data) => billingService.audit(event, { actorId, data }), log: operationalLog
});
const hardwareWiringAssistantService = new HardwareWiringAssistantService({
  hardwareService,
  driver: relayControllerDriver,
  tables: () => store.tables,
  hasActiveTableSession: tableId => Boolean(sessionRepository.findOpenSessionByTable(tableId)),
  conflict: async deviceRecordId => {
    if (hardwareWifiProvisioningService.isActiveForDevice(deviceRecordId)) return "การเปลี่ยน Wi-Fi";
    if (usbFlasherService.active && !["COMPLETED", "FAILED", "CANCELLED", "ENROLLMENT_PENDING"].includes(usbFlasherService.active.state)) return "USB Flasher";
    const setup = await relayControllerDriver.setupModeStatus(hardwareService.getRequired(deviceRecordId));
    return setup?.active ? "Setup Mode" : null;
  },
  audit: (event, actorId, data) => billingService.audit(event, { actorId, data })
});
reservationRepository = new ReservationRepository(path.join(dataDir, "reservations.json"));
reservationDepositRepository = new ReservationDepositRepository(path.join(dataDir, "reservation-deposits.json"));
const portableMigrationService = new PortableMigrationService({ getStore: () => store, reservations: reservationRepository, deposits: reservationDepositRepository, hardwareRepository });
const reservationAudit = (event, actorId, data) => billingService.audit(event, { actorId, data });
const reservationDepositService = new ReservationDepositService(reservationDepositRepository, { audit: reservationAudit });
const depositSettlementService = new DepositSettlementService(reservationDepositRepository, { reservationRepository, billingRepository, audit: reservationAudit });
paymentService.onBeforeConfirm = (bill, settlementActorId) => { if (!bill.depositId) return; const deposit = reservationDepositRepository.findById(bill.depositId); depositSettlementService.settle(deposit.id, bill, settlementActorId, deposit.version, deposit.lockToken); };
const reservationService = new ReservationService(reservationRepository, reservationDepositService, { settings: () => settingsService.getSettings(), tables: () => store.tables, relay: setRelayState, startSession: (reservation, user) => { const settings = settingsService.getSettings(), profile = settings.pricingProfiles.find(item => item.id === settings.defaultPricingProfileId); const session = sessionService.openSession({ tableId: reservation.assignedTableId, memberId: reservation.memberId || null, pricingProfile: profile }); session.reservationId = reservation.id; session.reservationNumber = reservation.reservationNumber; sessionRepository.saveSession(session); billingService.audit("TABLE_OPENED", { tableId: reservation.assignedTableId, sessionId: session.id, actorId: user.userId, data: { reservationId: reservation.id } }); return session; }, cancelSession: async sessionId => { if (!sessionId) return; const session = sessionRepository.findSession(sessionId); if (session && ["ACTIVE", "PAUSED"].includes(session.state)) sessionService.cancelSession(sessionId); }, memberById, audit: reservationAudit });
const tableConfigurationService = new TableConfigurationService({
  hasActiveSession: tableId => Boolean(sessionRepository.findOpenSessionByTable(tableId)),
  hasActiveReservation: tableId => reservationRepository.list().some(item => String(item.assignedTableId) === String(tableId) && !["CANCELLED", "NO_SHOW", "CHECKED_IN", "COMPLETED"].includes(item.status))
});
reservationService.normalizeLegacy();
const integrityCheckService = new IntegrityCheckService({ store: () => store, reservations: () => reservationRepository.list(), deposits: () => reservationDepositRepository.list() });
const recoveryService = new RecoveryService({ store: () => store, deposits: reservationDepositRepository, settlement: depositSettlementService, audit: reservationAudit });
let lastRecovery = recoveryService.run();
const healthService = new HealthService({
  dataFiles: () => [{ name: "store.json", file: dataFile }, { name: "reservations.json", file: reservationRepository.file }, { name: "reservation-deposits.json", file: reservationDepositRepository.file }].map(item => { try { return { name: item.name, exists: fs.existsSync(item.file), parseable: (JSON.parse(fs.readFileSync(item.file, "utf8")), true), bytes: fs.statSync(item.file).size }; } catch { return { name: item.name, exists: fs.existsSync(item.file), parseable: false, bytes: fs.existsSync(item.file) ? fs.statSync(item.file).size : 0 }; } }),
  activeTimers: () => 1,
  activeWrites: activeJsonWrites,
  backups: () => ({ ...(listBackups()[0] || { verificationStatus: "MISSING" }), externalBackup: lastExternalBackupStatus }),
  integrity: () => integrityCheckService.run(),
  recovery: () => lastRecovery,
  relay: () => !process.env.ESP32_BASE_URL ? "NOT_CONFIGURED" : store.tables.some(table=>table.relayPending) ? "WARNING" : "READY"
});
const emergencyResetRequested = process.env.LUCKY_EMERGENCY_RESET === "1";
if (!emergencyResetRequested) authService.bootstrap();
if (emergencyResetRequested) { const reset = authService.emergencyResetAdmin(); console.log(reset ? "Emergency password reset completed for admin.\nLogin:\nUsername: admin\nPassword: 123456789\n\nYou must change password after login." : "Admin account not found.\nEmergency reset skipped."); delete process.env.LUCKY_EMERGENCY_RESET; }
if (process.env.LUCKY_EMERGENCY_ENABLE_OWNER === "1") { const result=authService.emergencyReactivateOwner(); if(result.status==="reactivated") console.log("Emergency OWNER reactivation completed.\nUsername: admin\nStatus: ACTIVE"); else if(result.status==="not_found") console.log("OWNER account admin not found.\nEmergency reactivation skipped."); else console.error("Emergency reactivation stopped: admin is not an OWNER account."); delete process.env.LUCKY_EMERGENCY_ENABLE_OWNER; }
function tokenFromRequest(req) { return (req.headers.cookie || "").split(";").map(item => item.trim()).find(item => item.startsWith("lucky_session="))?.slice("lucky_session=".length) || req.get("x-session-token") || ""; }
function actorId(req) { return req.user?.userId || "SYSTEM"; }
function requireAuth(req, res, next) { const user = authService.current(tokenFromRequest(req)); if (!user) return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" }); req.user = user; next(); }
function requirePermission(permission) { return (req, res, next) => { if (!hasPermission(req.user.role, permission)) return res.status(403).json({ error: "คุณไม่มีสิทธิ์ใช้งานรายการนี้" }); next(); }; }
function requireHardwareAdmin(req, res, next) { if (!["OWNER", "ADMIN"].includes(req.user.role)) return res.status(403).json({ error: "HARDWARE_ACCESS_DENIED", message: "เฉพาะเจ้าของร้านหรือผู้ดูแลระบบเท่านั้น" }); next(); }
function requireLoopback(req,res,next){const address=String(req.socket.remoteAddress||"").replace(/^::ffff:/,"");if(address!=="::1"&&!address.startsWith("127."))return res.status(403).json({error:"FLASH_LOCAL_ONLY",message:"สั่ง Flash ได้เฉพาะเครื่องเซิร์ฟเวอร์"});const origin=req.get("origin");if(origin){try{const host=new URL(origin).hostname;if(host!=="localhost"&&host!=="::1"&&!host.startsWith("127."))return res.status(403).json({error:"FLASH_ORIGIN_REJECTED",message:"หน้าเว็บนี้ไม่ได้เปิดจากเครื่องเซิร์ฟเวอร์"});}catch{return res.status(403).json({error:"FLASH_ORIGIN_REJECTED"});}}next();}
function requireMemberManage(req,res,next){if(!["OWNER","MANAGER"].includes(req.user.role))return res.status(403).json({error:"คุณไม่มีสิทธิ์จัดการสมาชิก"});next();}
function safeBackupName(name) { const base = path.basename(String(name || "")); return /^backup-[\dTZ.-]+\.json$/.test(base) ? base : null; }
function inspectBackup(full) {
  try {
    const payload = JSON.parse(fs.readFileSync(full, "utf8"));
    if (payload?.formatVersion === 2 && payload.files) {
      const required = ["store.json","reservations.json","reservation-deposits.json"];
      const missing = required.filter(name => !(name in payload.files));
      const actual = checksum(payload.files);
      const valid = !missing.length && actual === payload.metadata?.checksum && validStoreShape(payload.files["store.json"]) && Array.isArray(payload.files["reservations.json"]) && Array.isArray(payload.files["reservation-deposits.json"]);
      return { verificationStatus: valid ? "VERIFIED" : "INVALID", missing, checksum: actual, metadata: payload.metadata, payload };
    }
    return { verificationStatus: validStoreShape(payload) ? "LEGACY_VALID" : "INVALID", missing: [], checksum: checksum(payload), metadata: null, payload };
  } catch (error) { return { verificationStatus: "INVALID", missing: [], error: error.message, payload: null }; }
}
function listBackups() {
  fs.mkdirSync(backupsDir, { recursive: true });
  return fs.readdirSync(backupsDir).filter(f => /^backup-.*\.json$/.test(f)).map(file => { const full=path.join(backupsDir,file),stat=fs.statSync(full),inspection=inspectBackup(full); return { file, backupId: inspection.metadata?.backupId || file, size: stat.size, createdAt: inspection.metadata?.createdAt || stat.mtime.toISOString(), fileCount: inspection.metadata?.fileCount || 1, checksum: inspection.metadata?.checksum || inspection.checksum, appVersion: inspection.metadata?.appVersion || "legacy", schemaVersion: inspection.metadata?.schemaVersion || 1, verifiedAt: new Date().toISOString(), verificationStatus: inspection.verificationStatus }; }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function pruneBackups() { const list = listBackups(); list.slice(MAX_BACKUPS).forEach(b => fs.unlinkSync(path.join(backupsDir, b.file))); }
function pruneExternalBackups(directory) {
  const entries = fs.readdirSync(directory).filter(f => /^backup-.*\.json$/.test(f)).map(file => ({ file, mtime: fs.statSync(path.join(directory, file)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  entries.slice(MAX_BACKUPS).forEach(entry => fs.unlinkSync(path.join(directory, entry.file)));
}
// Mirrors the just-verified local backup to an owner-configured external folder (e.g. a
// permanently attached USB drive or a mapped network path). Best-effort: the local backup is
// already the source of truth and must never fail because the external drive is unplugged, so
// failures here are logged as a WARNING (surfaced through /api/health) rather than thrown.
function mirrorBackupExternally(file, payload) {
  const externalPath = String(settingsService.getSettings().backupExternalPath || "").trim();
  if (!externalPath) { lastExternalBackupStatus = null; return; }
  const checkedAt = new Date().toISOString();
  try {
    const directory = path.resolve(externalPath);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, file);
    atomicWriteJson(target, payload, { keepBackup: false });
    const inspection = inspectBackup(target);
    if (inspection.verificationStatus !== "VERIFIED") throw new Error("External backup verification failed");
    pruneExternalBackups(directory);
    lastExternalBackupStatus = { status: "VERIFIED", path: directory, file, checkedAt };
    operationalLog("INFO", "EXTERNAL_BACKUP_VERIFIED", { file, path: directory });
  } catch (error) {
    lastExternalBackupStatus = { status: "UNREACHABLE", path: externalPath, message: error.message, checkedAt };
    operationalLog("WARN", "EXTERNAL_BACKUP_FAILED", { file, path: externalPath, errorCode: error.code || "EXTERNAL_BACKUP_FAILED" });
  }
}
function backupNow() {
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backup-${stamp}.json`;
  const files = { "store.json": store, "reservations.json": reservationRepository.list(), "reservation-deposits.json": reservationDepositRepository.list() };
  const createdAt=new Date().toISOString(),metadata = { backupId: `BKP-${crypto.randomUUID()}`, createdAt, fileCount: Object.keys(files).length, checksum: checksum(files), size: 0, appVersion: require("./package.json").version, schemaVersion: 2, verifiedAt: createdAt, verificationStatus: "VERIFIED" };
  const payload={formatVersion:2,metadata,files};for(let attempt=0;attempt<3;attempt+=1){const bytes=Buffer.byteLength(JSON.stringify(payload,null,2));if(bytes===metadata.size)break;metadata.size=bytes;}
  const target = path.join(backupsDir, file);
  atomicWriteJson(target, payload, { keepBackup: false });
  const inspection = inspectBackup(target);
  if (inspection.verificationStatus !== "VERIFIED") throw new Error("Backup verification failed");
  operationalLog("INFO","BACKUP_VERIFIED",{backupId:metadata.backupId,file,checksum:metadata.checksum,size:fs.statSync(target).size});
  pruneBackups();
  mirrorBackupExternally(file, payload);
  return { file, ...metadata, size: fs.statSync(target).size };
}
function maybeAutoBackup() {
  if (!reservationRepository || !reservationDepositRepository) return;
  const list = listBackups();
  const latest = list[0];
  if (!latest || Date.now() - new Date(latest.createdAt).getTime() > AUTO_BACKUP_INTERVAL_MS) backupNow();
}
function id(prefix) { return `${prefix}-${crypto.randomUUID().slice(0, 8)}`; }
function tableById(tableId) { return store.tables.find(t => String(t.id) === String(tableId)); }
function memberById(memberId) { return store.members.find(m => m.id === memberId); }
function elapsedSeconds(table) { return table.startTime ? Math.max(0, Math.floor((Date.now() - new Date(table.startTime).getTime()) / 1000)) : 0; }
function legacyTableChargeSatang(table) { return bahtToSatang(Math.max(store.settings.minimumCharge, elapsedSeconds(table) / 3600 * store.settings.hourlyRate)); }
function tableChargeSatang(table) { const session = sessionRepository.findSessionByTable(table.id); return session ? sessionService.previewCharge(session.id) : legacyTableChargeSatang(table); }
function apiBaht(satang) { return Number(satangToBaht(satang)); }
function enrichTable(table) { const session = sessionRepository.findSessionByTable(table.id); const active = table.status === "playing" || table.status === "paused" || table.status === "awaiting_payment"; return { ...table, ...hardwareService.tableHardware(table), elapsedSeconds: session ? sessionService.billableSeconds(session) : elapsedSeconds(table), currentPrice: active ? apiBaht(tableChargeSatang(table)) : 0, member: memberById(table.memberId) || null, sessionState: session?.state || null }; }
function createBill(table, closedSession, loggedInActorId = "SYSTEM") { return billingService.createBillDraft({ table, session: closedSession, memberName: memberById(table.memberId)?.name || "ลูกค้าทั่วไป", actorId: loggedInActorId }); }
const relayService=new RelayService({baseUrl:process.env.ESP32_BASE_URL,logger:(level,event,details)=>operationalLog(level,event,details)});
async function setRelayState(table,state){try{return await hardwareService.setTableRelay(table,state);}catch(error){operationalLog("ERROR","HARDWARE_RELAY_FAILED",{tableId:table.id,errorCode:error.code||"HARDWARE_ERROR"});return {connected:false,failed:true,code:error.code,message:error.message};}}

function operationalLog(level,event,details={}) { console.log(JSON.stringify({timestamp:new Date().toISOString(),level,event,...details})); }
app.use((req,res,next)=>{const started=Date.now();req.requestId=req.get("x-request-id")||crypto.randomUUID();res.setHeader("X-Request-Id",req.requestId);res.on("finish",()=>operationalLog("INFO","HTTP_REQUEST",{requestId:req.requestId,userId:req.user?.userId||null,route:req.originalUrl.split("?")[0],status:res.statusCode,durationMs:Date.now()-started}));next();});
app.use(express.json());
app.post("/api/auth/login", (req, res) => { try { const result = authService.login(req.body?.username, req.body?.password); res.setHeader("Set-Cookie", `lucky_session=${result.token}; HttpOnly; SameSite=Strict; Path=/`); res.json({ user: result.user }); } catch (error) { res.status(401).json({ error: error.message }); } });
app.post("/api/auth/logout", (req, res) => { authService.logout(tokenFromRequest(req)); res.setHeader("Set-Cookie", "lucky_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); res.json({ message: "ออกจากระบบแล้ว" }); });
app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));
app.get("/api/session/status", requireAuth, (req,res)=>res.json(authService.sessionStatus(tokenFromRequest(req))));
app.patch("/api/session/refresh", requireAuth, (req,res)=>{try{res.json(authService.refreshSession(tokenFromRequest(req),actorId(req)));}catch(error){res.status(401).json({error:error.message});}});
app.get("/api/state", requireAuth, async (req, res) => { await reservationService.processDue(); res.json({ settings: settingsService.getSettings(), tables: store.tables.map(enrichTable), members: store.members, products: inventoryService.listProducts({ pageSize: 1000 }, req.user.role).items, posOrders: store.posOrders || [], bills: store.bills, payments: store.payments, reservations: reservationService.list(), reservationDeposits: reservationDepositService.list(), reservationDashboard: { ...reservationService.dashboard(), ...depositSettlementService.dashboard() }, user: req.user }); });
app.use("/api", (req, res, next) => { if (req.path.startsWith("/auth/")) return next(); return requireAuth(req, res, next); });
const reservationError = (res, error) => res.status(error.code === "FORBIDDEN" ? 403 : /not found/i.test(error.message) ? 404 : ["VERSION_CONFLICT","RESERVATION_OPERATION_IN_PROGRESS"].includes(error.code) ? 409 : 400).json({ error: error.code || "RESERVATION_ERROR", message: error.message });
app.get("/api/reservations", requirePermission(PERMISSIONS.RESERVATION_VIEW), async (req, res) => { try { await reservationService.processDue(); res.json({ items: reservationService.list(req.query), dashboard: reservationService.dashboard() }); } catch (error) { reservationError(res, error); } });
app.get("/api/reservation-alerts/pending", requirePermission(PERMISSIONS.RESERVATION_VIEW), async (req, res) => { try { await reservationService.processDue(); res.json(reservationService.pendingAlerts()); } catch (error) { reservationError(res, error); } });
app.get("/api/reservations/priority-queue", requirePermission(PERMISSIONS.RESERVATION_VIEW), async (req, res) => { try { await reservationService.processDue(); res.json({ items: reservationService.priorityQueue() }); } catch (error) { reservationError(res, error); } });
app.post("/api/reservations", requirePermission(PERMISSIONS.RESERVATION_MANAGE), (req, res) => { try { res.status(201).json(reservationService.create(req.body, req.user)); } catch (error) { reservationError(res, error); } });
app.patch("/api/reservations/:id", requirePermission(PERMISSIONS.RESERVATION_MANAGE), (req, res) => { try { res.json({ reservation: reservationService.update(req.params.id, req.body, req.user) }); } catch (error) { reservationError(res, error); } });
app.post("/api/reservations/:id/open-now", requirePermission(PERMISSIONS.RESERVATION_MANAGE), async (req, res) => { try { res.json(await reservationService.openNow(req.params.id, req.user, req.body?.expectedVersion)); } catch (error) { reservationError(res, error); } });
app.post("/api/reservations/:id/defer", requirePermission(PERMISSIONS.RESERVATION_MANAGE), (req, res) => { try { res.json({ reservation: reservationService.defer(req.params.id, req.user, req.body?.expectedVersion) }); } catch (error) { reservationError(res, error); } });
app.post("/api/reservations/:id/check-in", requirePermission(PERMISSIONS.RESERVATION_CHECKIN), (req, res) => { try { res.json({ reservation: reservationService.checkIn(req.params.id, req.user) }); } catch (error) { reservationError(res, error); } });
app.post("/api/tables/:tableId/reservation-check-in", requirePermission(PERMISSIONS.RESERVATION_CHECKIN), (req, res) => { try { const reservation = reservationService.list().find(item => String(item.assignedTableId) === String(req.params.tableId) && item.status === "OPENED_WAITING_CHECK_IN"); if (!reservation) return res.status(404).json({ error: "RESERVATION_NOT_WAITING_CHECK_IN", message: "No reservation is waiting for check-in at this table" }); res.json({ reservation: reservationService.checkIn(reservation.id, req.user) }); } catch (error) { reservationError(res, error); } });
app.patch("/api/reservations/:id/check-in", requirePermission(PERMISSIONS.RESERVATION_CHECKIN), (req, res) => { try { res.json({ reservation: reservationService.checkIn(req.params.id, req.user) }); } catch (error) { reservationError(res, error); } });
app.patch("/api/reservations/:id/cancel", requirePermission(PERMISSIONS.RESERVATION_MANAGE), async (req, res) => { try { res.json({ reservation: await reservationService.cancel(req.params.id, req.user) }); } catch (error) { reservationError(res, error); } });
app.patch("/api/reservations/:id/no-show", requirePermission(PERMISSIONS.RESERVATION_DEPOSIT_ADJUST), async (req, res) => { try { res.json({ reservation: await reservationService.noShow(req.params.id, req.user) }); } catch (error) { reservationError(res, error); } });
app.get("/api/reservation-deposits", requirePermission(PERMISSIONS.RESERVATION_VIEW), (req, res) => res.json({ items: reservationDepositService.list(req.query) }));
app.get("/api/reservations/:id/deposit", requirePermission(PERMISSIONS.RESERVATION_VIEW), (req, res) => { const reservation = reservationRepository.findById(req.params.id); if (!reservation) return res.status(404).json({ error: "Reservation not found" }); res.json({ deposit: reservationDepositRepository.findByReservationId(req.params.id) }); });
app.post("/api/deposits/:id/lock", requirePermission(PERMISSIONS.RESERVATION_MANAGE), (req, res) => { try { res.json({ deposit: depositSettlementService.lock(req.params.id, actorId(req), req.body?.version, req.body?.lockToken) }); } catch (error) { reservationError(res, error); } });
app.post("/api/deposits/:id/unlock", requirePermission(PERMISSIONS.RESERVATION_MANAGE), (req, res) => { try { res.json({ deposit: depositSettlementService.unlock(req.params.id, actorId(req), req.body?.version, req.body?.lockToken) }); } catch (error) { reservationError(res, error); } });
app.post("/api/deposits/:id/settle", requirePermission(PERMISSIONS.RESERVATION_MANAGE), (req, res) => { try { const bill = billingRepository.findBill(req.body?.billId); if (!bill) return res.status(404).json({ error: "Bill not found" }); res.json({ deposit: depositSettlementService.settle(req.params.id, bill, actorId(req), req.body?.version, req.body?.lockToken), bill }); } catch (error) { reservationError(res, error); } });
app.patch("/api/reservation-deposits/:id/void", requirePermission(PERMISSIONS.RESERVATION_DEPOSIT_ADJUST), (req, res) => { try { res.json({ deposit: reservationDepositService.void(req.params.id, req.body?.reason, req.user) }); } catch (error) { reservationError(res, error); } });
app.patch("/api/reservation-deposits/:id/refund", requirePermission(PERMISSIONS.RESERVATION_DEPOSIT_ADJUST), (req, res) => { try { res.json({ deposit: reservationDepositService.refund(req.params.id, req.body?.reason, req.user) }); } catch (error) { reservationError(res, error); } });
app.get("/api/reservation-dashboard", requirePermission(PERMISSIONS.RESERVATION_VIEW), (req, res) => res.json(reservationService.dashboard()));
app.get("/api/reservation-reports/:type", requirePermission(PERMISSIONS.REPORT_VIEW), (req, res) => res.json({ items: reservationService.report(req.params.type, req.query) }));
app.get("/api/reports/deposit-settlement", requirePermission(PERMISSIONS.REPORT_VIEW), (req, res) => res.json({ items: depositSettlementService.report() }));
app.get("/api/users", requirePermission(PERMISSIONS.USER_MANAGE), (req,res)=>res.json({ users:userRepository.users().map(user=>authService.publicUser(user)) }));
app.get("/api/sessions", requireAuth, (req,res)=>{ if(!["OWNER","MANAGER"].includes(req.user.role)) return res.status(403).json({error:"คุณไม่มีสิทธิ์ดู Session"}); res.json({sessions:authService.listSessions().map(session=>{const user=userRepository.findById(session.userId);return {...session,username:user?.username||session.userId,displayName:user?.displayName||session.userId,role:user?.role||"-",current:session.id===authService.sessionStatus(tokenFromRequest(req))?.sessionId,remainingMs:Math.max(0,settingsService.getSettings().security.timeoutMinutes*60000-(Date.now()-new Date(session.lastActivity).getTime()))};})}); });
app.get("/api/security/summary", requireAuth, (req,res)=>{ if(!["OWNER","MANAGER"].includes(req.user.role)) return res.status(403).json({error:"คุณไม่มีสิทธิ์ดูข้อมูลความปลอดภัย"}); const users=userRepository.users(), sessions=authService.listSessions(), now=Date.now(); res.json({activeSessions:sessions.length,onlineUsers:new Set(sessions.map(session=>session.userId)).size,lockedAccounts:users.filter(user=>user.lockedUntil&&new Date(user.lockedUntil).getTime()>now).length,disabledUsers:users.filter(user=>user.status==="DISABLED").length}); });
app.delete("/api/sessions/:id", requirePermission(PERMISSIONS.USER_MANAGE), (req,res)=>res.json({revoked:authService.revokeSession(req.params.id,actorId(req),tokenFromRequest(req))}));
app.delete("/api/sessions", requirePermission(PERMISSIONS.USER_MANAGE), (req,res)=>{let count=0; for(const session of authService.listSessions()) if(authService.revokeSession(session.id,actorId(req),tokenFromRequest(req))) count++; res.json({revoked:count});});
app.get("/api/settings/session", requireAuth,(req,res)=>res.json(settingsService.getSettings().security));
app.patch("/api/settings/session", requirePermission(PERMISSIONS.SETTINGS_MANAGE),(req,res)=>{try{const security={...settingsService.getSettings().security,...req.body}; for(const key of ["timeoutMinutes","maxLoginAttempts","lockDurationMinutes"])if(!Number.isInteger(security[key])||security[key]<1)throw new Error("Invalid security setting"); if(!Number.isInteger(security.warningMinutes)||security.warningMinutes<0||security.warningMinutes>=security.timeoutMinutes)throw new Error("Warning minutes must be less than timeout"); res.json(settingsService.updateSettings({security}).security);}catch(error){res.status(400).json({error:error.message});}});
app.post("/api/users", requirePermission(PERMISSIONS.USER_MANAGE), (req,res)=>{try{res.status(201).json(authService.createUser(req.body,actorId(req)));}catch(error){res.status(400).json({error:error.message});}});
app.patch("/api/users/:id", requirePermission(PERMISSIONS.USER_MANAGE), (req,res)=>{try{res.json(authService.updateUser(req.params.id,req.body,actorId(req)));}catch(error){res.status(400).json({error:error.message});}});
app.patch("/api/users/:id/status", requirePermission(PERMISSIONS.USER_MANAGE), (req,res)=>{try{res.json(authService.setStatus(req.params.id,req.body.status,actorId(req)));}catch(error){res.status(400).json({error:error.message});}});
app.patch("/api/users/:id/password", requireAuth, (req,res)=>{try{const own=req.user.userId===req.params.id; if(!own&&!hasPermission(req.user.role,PERMISSIONS.USER_MANAGE)) return res.status(403).json({error:"คุณไม่มีสิทธิ์รีเซ็ตรหัสผ่าน"}); if(own&&!req.body.currentPassword) return res.status(400).json({error:"กรุณาระบุรหัสผ่านเดิม"}); if(own&&!require("./services/auth-service").verifyPassword(req.body.currentPassword,userRepository.findById(req.params.id).passwordHash)) return res.status(400).json({error:"รหัสผ่านเดิมไม่ถูกต้อง"}); res.json(authService.changePassword(req.params.id,req.body.password,actorId(req),!own));}catch(error){res.status(400).json({error:error.message});}});
app.get("/api/bills", (req, res) => { try { res.json(billHistoryService.search(req.query)); } catch (error) { res.status(400).json({ error: error.message }); } });
app.get("/api/audit-logs", requirePermission(PERMISSIONS.AUDIT_VIEW), (req, res) => { try { res.json(auditLogService.search(req.query)); } catch (error) { res.status(400).json({ error: error.message }); } });
app.get("/api/audit-logs/event-types", requirePermission(PERMISSIONS.AUDIT_VIEW), (req, res) => res.json({ items: auditLogService.eventTypes() }));
app.get("/api/bills/:id", (req, res) => { try { res.json(billHistoryService.details(req.params.id)); } catch (error) { res.status(error.message === "Bill not found" ? 404 : 400).json({ error: error.message }); } });
app.put("/api/settings", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req, res) => {
  const previousSettings = { ...store.settings }, previousTables = store.tables.map(table => ({ ...table }));
  try {
    const beforeRewards = settingsService.getSettings().rewards;
    const requestedCount = req.body?.tableCount === undefined ? store.tables.length : Number(req.body.tableCount);
    const nextTables = tableConfigurationService.resize(store.tables, requestedCount);
    if (nextTables.length !== store.tables.length) backupNow();
    store.tables = nextTables;
    const updated = settingsService.updateSettings({ ...req.body, tableCount: nextTables.length });
    if (JSON.stringify(beforeRewards) !== JSON.stringify(updated.rewards)) billingService.audit("REWARD_SETTING_CHANGED", { actorId:actorId(req), data:{ before:beforeRewards, after:updated.rewards } });
    if (previousTables.length !== nextTables.length) billingService.audit("TABLE_COUNT_CHANGED", { actorId:actorId(req), data:{ before:previousTables.length, after:nextTables.length } });
    res.json({ ...updated, tableCount: nextTables.length });
  } catch (error) {
    store.settings = previousSettings; store.tables = previousTables;
    try { save(); } catch {}
    res.status(error.code === "TABLE_IN_USE" ? 409 : 400).json({ error:error.code || "SETTINGS_UPDATE_FAILED", message:error.message });
  }
});
app.get("/api/backups", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req, res) => res.json(listBackups()));
app.post("/api/backups", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req, res) => { try { res.status(201).json(backupNow()); } catch (error) { res.status(500).json({ error: "BACKUP_FAILED", message: error.message }); } });
app.get("/api/backups/:file/download", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req, res) => { const file = safeBackupName(req.params.file); if (!file) return res.status(400).json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }); const full = path.join(backupsDir, file); if (!fs.existsSync(full)) return res.status(404).json({ error: "ไม่พบไฟล์สำรองข้อมูล" }); res.download(full, file); });
app.post("/api/backups/:file/dry-run", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req, res) => { const file=safeBackupName(req.params.file);if(!file)return res.status(400).json({error:"INVALID_BACKUP_NAME"});const full=path.join(backupsDir,file);if(!fs.existsSync(full))return res.status(404).json({error:"BACKUP_NOT_FOUND"});const result=inspectBackup(full),payload=result.payload,files=payload?.formatVersion===2?payload.files:{"store.json":payload,"reservations.json":[],"reservation-deposits.json":[]};const integrity=payload&&result.verificationStatus!=="INVALID"?new IntegrityCheckService({store:()=>files["store.json"],reservations:()=>files["reservations.json"],deposits:()=>files["reservation-deposits.json"]}).run():null;const status=result.verificationStatus==="INVALID"?"INVALID":integrity?.status==="ERROR"?"WARNING":"RESTORABLE";res.json({status,verificationStatus:result.verificationStatus,missing:result.missing,integrity}); });
app.post("/api/backups/:file/restore", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req, res) => { const file = safeBackupName(req.params.file); if (!file) return res.status(400).json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }); const full = path.join(backupsDir, file); if (!fs.existsSync(full)) return res.status(404).json({ error: "ไม่พบไฟล์สำรองข้อมูล" }); const inspection=inspectBackup(full);if(inspection.verificationStatus==="INVALID")return res.status(400).json({error:"BACKUP_INVALID",message:"ไฟล์สำรองข้อมูลไม่ผ่านการตรวจสอบ"}); const payload=inspection.payload,files=payload?.formatVersion===2?payload.files:{"store.json":payload,"reservations.json":reservationRepository.list(),"reservation-deposits.json":reservationDepositRepository.list()},previous={store,reservations:reservationRepository.list(),deposits:reservationDepositRepository.list()};backupNow();try{atomicWriteJson(dataFile,files["store.json"]);atomicWriteJson(reservationRepository.file,files["reservations.json"]);atomicWriteJson(reservationDepositRepository.file,files["reservation-deposits.json"]);store=files["store.json"];reservationRepository.items=files["reservations.json"];reservationDepositRepository.items=files["reservation-deposits.json"];}catch(error){atomicWriteJson(dataFile,previous.store);atomicWriteJson(reservationRepository.file,previous.reservations);atomicWriteJson(reservationDepositRepository.file,previous.deposits);store=previous.store;reservationRepository.items=previous.reservations;reservationDepositRepository.items=previous.deposits;operationalLog("ERROR","RESTORE_ROLLED_BACK",{requestId:req.requestId,userId:req.user.userId,file,errorCode:error.code||"RESTORE_FAILED"});return res.status(500).json({error:"RESTORE_ROLLED_BACK",message:error.message});}lastRecovery=recoveryService.run();operationalLog("INFO","RESTORE_COMPLETED",{requestId:req.requestId,userId:req.user.userId,file,verificationStatus:inspection.verificationStatus});res.json({ message: `กู้คืนข้อมูลจาก ${file} แล้ว (ระบบสำรองข้อมูลก่อนกู้คืนไว้ให้อัตโนมัติ)` }); });
app.delete("/api/backups/:file", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req, res) => { const file = safeBackupName(req.params.file); if (!file) return res.status(400).json({ error: "ชื่อไฟล์ไม่ถูกต้อง" }); const full = path.join(backupsDir, file); if (!fs.existsSync(full)) return res.status(404).json({ error: "ไม่พบไฟล์สำรองข้อมูล" }); fs.unlinkSync(full); res.json({ message: `ลบไฟล์สำรองข้อมูล ${file} แล้ว` }); });
function memberReadQuery(req){ const query={...req.query}; if(req.user?.role==="STAFF") query.status="ACTIVE"; return query; }
app.get("/api/members", requireAuth,(req,res)=>res.json({items:memberService.list(memberReadQuery(req))}));
app.get("/api/members/search", requireAuth,(req,res)=>res.json({items:memberService.list(memberReadQuery(req))}));
app.get("/api/members/:id", requireAuth,(req,res)=>{const member=memberRepository.findById(req.params.id);if(!member)return res.status(404).json({error:"Member not found"});res.json({member});});
app.get("/api/members/:id/points", requireAuth,(req,res)=>res.json({items:memberService.history(req.params.id)}));
app.post("/api/members", requireAuth,requireMemberManage,(req,res)=>{try{res.status(201).json({member:memberService.create(req.body||{},actorId(req))});}catch(error){res.status(409).json({error:error.message});}});
app.patch("/api/members/:id", requireAuth,requireMemberManage,(req,res)=>{try{res.json({member:memberService.update(req.params.id,req.body||{},actorId(req))});}catch(error){res.status(/not found/i.test(error.message)?404:409).json({error:error.message});}});
app.patch("/api/members/:id/status", requireAuth,requireMemberManage,(req,res)=>{try{res.json({member:memberService.status(req.params.id,req.body?.status,actorId(req))});}catch(error){res.status(/not found/i.test(error.message)?404:400).json({error:error.message});}});
app.get("/api/products", requirePermission(PERMISSIONS.PRODUCT_VIEW), (req, res) => { try { res.json(inventoryService.listProducts(req.query, req.user.role)); } catch (error) { res.status(400).json({ error: error.message }); } });
app.get("/api/products/:id", requirePermission(PERMISSIONS.PRODUCT_VIEW), (req, res) => { const product = inventoryService.getProduct(req.params.id, req.user.role); if (!product) return res.status(404).json({ error: "ไม่พบสินค้า" }); res.json(product); });
app.post("/api/products", requirePermission(PERMISSIONS.PRODUCT_MANAGE), (req, res) => { try { res.status(201).json(inventoryService.createProduct(req.body || {}, actorId(req))); } catch (error) { res.status(error.message.includes("already exists") ? 409 : 400).json({ error: error.message }); } });
app.patch("/api/products/:id", requirePermission(PERMISSIONS.PRODUCT_MANAGE), (req, res) => { try { res.json(inventoryService.updateProduct(req.params.id, req.body || {}, actorId(req))); } catch (error) { res.status(error.message === "Product not found" || error.message === "Category not found" ? 404 : error.message.includes("already exists") ? 409 : 400).json({ error: error.message }); } });
app.patch("/api/products/:id/status", requirePermission(PERMISSIONS.PRODUCT_MANAGE), (req, res) => { try { res.json(inventoryService.changeProductStatus(req.params.id, req.body?.status, actorId(req))); } catch (error) { res.status(error.message === "Product not found" ? 404 : 400).json({ error: error.message }); } });
app.post("/api/products/:id/stock/receive", requirePermission(PERMISSIONS.INVENTORY_MANAGE), (req, res) => { try { res.json(inventoryService.receiveStock(req.params.id, req.body || {}, actorId(req))); } catch (error) { res.status(error.message === "Product not found" ? 404 : 400).json({ error: error.message }); } });
app.post("/api/products/:id/stock/adjust", requirePermission(PERMISSIONS.INVENTORY_MANAGE), (req, res) => { try { res.json(inventoryService.adjustStock(req.params.id, req.body || {}, actorId(req))); } catch (error) { res.status(error.message === "Product not found" ? 404 : 400).json({ error: error.message }); } });
app.get("/api/products/:id/stock-movements", requirePermission(PERMISSIONS.PRODUCT_VIEW), (req, res) => { try { res.json(inventoryService.getStockMovements(req.params.id, req.query)); } catch (error) { res.status(error.message === "Product not found" ? 404 : 400).json({ error: error.message }); } });
app.get("/api/product-categories", requirePermission(PERMISSIONS.PRODUCT_VIEW), (req, res) => res.json({ items: inventoryService.listCategories(req.user.role) }));
app.post("/api/product-categories", requirePermission(PERMISSIONS.PRODUCT_MANAGE), (req, res) => { try { res.status(201).json(inventoryService.createCategory(req.body || {}, actorId(req))); } catch (error) { res.status(error.message.includes("already exists") ? 409 : 400).json({ error: error.message }); } });
app.patch("/api/product-categories/:id", requirePermission(PERMISSIONS.PRODUCT_MANAGE), (req, res) => { try { res.json(inventoryService.updateCategory(req.params.id, req.body || {}, actorId(req))); } catch (error) { res.status(error.message === "Category not found" ? 404 : error.message.includes("already exists") ? 409 : 400).json({ error: error.message }); } });
app.patch("/api/product-categories/:id/status", requirePermission(PERMISSIONS.PRODUCT_MANAGE), (req, res) => { try { res.json(inventoryService.changeCategoryStatus(req.params.id, req.body?.status, actorId(req))); } catch (error) { res.status(error.message === "Category not found" ? 404 : 400).json({ error: error.message }); } });
function posOrderError(res, error) { const status = error.code === "FORBIDDEN" ? 403 : error.code === "INSUFFICIENT_STOCK" || error.code === "DUPLICATE_CONFIRM" || error.code === "ORDER_STATUS_CONFLICT" || /disabled|draft|already|cannot be cancelled/i.test(error.message) ? 409 : /not found/i.test(error.message) ? 404 : 400; res.status(status).json({ error: error.code || "POS_ORDER_ERROR", message: error.message, details: error.details }); }
app.post("/api/pos-orders", requirePermission(PERMISSIONS.POS_ORDER_CREATE), (req, res) => { try { res.status(201).json({ order: posOrderService.createOrder(req.body || {}, req.user) }); } catch (error) { posOrderError(res, error); } });
app.get("/api/pos-orders", requirePermission(PERMISSIONS.POS_ORDER_VIEW), (req, res) => { try { res.json(posOrderService.listOrders(req.query, req.user)); } catch (error) { posOrderError(res, error); } });
app.get("/api/pos-orders/:id", requirePermission(PERMISSIONS.POS_ORDER_VIEW), (req, res) => { try { const order = posOrderService.getOrder(req.params.id, req.user); if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND", message: "POS order not found" }); res.json({ order }); } catch (error) { posOrderError(res, error); } });
function rewardError(code, message) { const error = new Error(message); error.code = code; return error; }
function normalizeRewardRequest(input={}) { const memberId=String(input.memberId??"").trim()||null, raw=input.redeemedPoints??input.points??0, points=raw===""||raw===null||raw===undefined?0:Number(raw); if(!Number.isInteger(points)||points<0) throw rewardError("INVALID_REDEEM_POINTS","Redeemed points must be a non-negative integer"); return { memberId, redeemedPoints:points, redeemValue:0, rewardPolicySnapshot:null }; }
function rewardPreviewInput(input={}) { const reward=normalizeRewardRequest(input); return { memberId: reward.memberId, totalSatang: Number(input.totalSatang || 0), total: Number(input.total || 0), saleSource: input.saleSource || "TABLE", status: "awaiting_payment" }; }
function shouldRedeem(reward, saleSource="TABLE") { if(!reward.redeemedPoints)return false; if(saleSource==="WALK_IN") throw rewardError("REDEEM_NOT_ALLOWED","Walk-in sales cannot redeem points"); if(!reward.memberId) throw rewardError("MEMBER_REQUIRED","A member is required to redeem points"); return true; }
function selectBillRewards(bill, reward, actor) { if (!shouldRedeem(reward)) return null; const result = memberService.selectRedeem(bill, reward.redeemedPoints, settingsService.getSettings(), actor); billingRepository.saveBill(bill); return result; }
function sendRewardError(res,error,fallback="VALIDATION_ERROR"){const code=error.code||fallback;const status=["INVALID_REDEEM_POINTS","MEMBER_REQUIRED","VALIDATION_ERROR"].includes(code)?400:409;res.status(status).json({error:code,message:error.message});}
app.post("/api/rewards/preview", requirePermission(PERMISSIONS.REWARD_REDEEM), (req,res)=>{try{const reward=normalizeRewardRequest(req.body);const bill=rewardPreviewInput(req.body);if(!shouldRedeem(reward,bill.saleSource))return res.json({points:0,discount:0,discountSatang:0,netTotal:Number((bill.totalSatang/100).toFixed(2)),netTotalSatang:bill.totalSatang,maximumPoints:0,maximumValue:0,memberBalance:null,policy:settingsService.getSettings().rewards});const preview=memberService.previewRedeem(bill,reward.redeemedPoints,settingsService.getSettings());res.json({points:preview.points,discount:preview.valueSatang/100,discountSatang:preview.valueSatang,netTotal:preview.netTotalSatang/100,netTotalSatang:preview.netTotalSatang,maximumPoints:preview.maximumPoints,maximumValue:preview.maximumValueSatang/100,memberBalance:preview.member.points,policy:preview.policy});}catch(error){sendRewardError(res,error);}});
app.get("/api/pos-orders/:id/billing-preview", requirePermission(PERMISSIONS.TABLE_CLOSE), (req, res) => { try { res.json(combinedBillingService.previewWalkInBilling(req.params.id)); } catch (error) { const status = error.code === "ORDER_ALREADY_BILLED" ? 409 : error.code === "ORDER_NOT_FOUND" ? 404 : 400; res.status(status).json({ error: error.code || "WALK_IN_PREVIEW_ERROR", message: error.message, details: error.details }); } });
app.post("/api/pos-orders/:id/create-bill", requirePermission(PERMISSIONS.TABLE_CLOSE), (req, res) => { try { const preview=combinedBillingService.previewWalkInBilling(req.params.id), reward=normalizeRewardRequest({...req.body,memberId:req.body?.memberId??preview.memberId}); if(shouldRedeem(reward,"WALK_IN")) memberService.previewRedeem(rewardPreviewInput({memberId:reward.memberId,totalSatang:preview.totalSatang,saleSource:"WALK_IN"}),reward.redeemedPoints,settingsService.getSettings()); const result = combinedBillingService.createWalkInBill(req.params.id, actorId(req)); const { payment } = paymentService.createPayment({ billId: result.bill.id, method: req.body?.paymentMethod || "cash", amountSatang: result.bill.totalSatang, actorId: actorId(req) }); res.json({ ...result, payment }); } catch (error) { if(error.code&&error.code!=="ORDER_ALREADY_BILLED"&&error.code!=="ORDER_NOT_FOUND")return sendRewardError(res,error); const status = error.code === "ORDER_ALREADY_BILLED" ? 409 : error.code === "ORDER_NOT_FOUND" ? 404 : 400; res.status(status).json({ error: error.code || "WALK_IN_BILL_ERROR", message: error.message, details: error.details }); } });
app.post("/api/pos-orders/:id/items", requirePermission(PERMISSIONS.POS_ORDER_EDIT), (req, res) => { try { res.json({ order: posOrderService.addItem(req.params.id, req.body || {}, req.user) }); } catch (error) { posOrderError(res, error); } });
app.patch("/api/pos-orders/:id/items/:itemId", requirePermission(PERMISSIONS.POS_ORDER_EDIT), (req, res) => { try { res.json({ order: posOrderService.updateItemQuantity(req.params.id, req.params.itemId, req.body || {}, req.user) }); } catch (error) { posOrderError(res, error); } });
app.delete("/api/pos-orders/:id/items/:itemId", requirePermission(PERMISSIONS.POS_ORDER_EDIT), (req, res) => { try { res.json({ order: posOrderService.removeItem(req.params.id, req.params.itemId, req.user) }); } catch (error) { posOrderError(res, error); } });
app.patch("/api/pos-orders/:id", requirePermission(PERMISSIONS.POS_ORDER_EDIT), (req, res) => { try { res.json({ order: posOrderService.updateOrderMetadata(req.params.id, req.body || {}, req.user) }); } catch (error) { posOrderError(res, error); } });
app.post("/api/pos-orders/:id/confirm", requirePermission(PERMISSIONS.POS_ORDER_CONFIRM), async (req, res) => { try { res.json({ order: await posOrderService.confirmOrder(req.params.id, req.user) }); } catch (error) { posOrderError(res, error); } });
app.post("/api/pos-orders/:id/cancel", requirePermission(PERMISSIONS.POS_ORDER_CANCEL_DRAFT), async (req, res) => { try { res.json({ order: await posOrderService.cancelOrder(req.params.id, req.body || {}, req.user) }); } catch (error) { posOrderError(res, error); } });
app.post("/api/tables/:id/start", requirePermission(PERMISSIONS.TABLE_OPEN), async (req, res) => { try { const table = tableById(req.params.id); if (!table) return res.status(404).json({ error: "ไม่พบโต๊ะ" }); if (req.body.memberId && memberById(req.body.memberId)?.status !== "ACTIVE") return res.status(400).json({ error: "ไม่พบสมาชิกที่ใช้งานอยู่" }); const settings = settingsService.getSettings(); const profile = settings.pricingProfiles.find(item => item.id === settings.defaultPricingProfileId); const session = sessionService.openSession({ tableId: table.id, memberId: req.body.memberId || null, pricingProfile: profile }); billingService.audit("TABLE_OPENED", { tableId: table.id, sessionId: session.id, actorId: actorId(req) }); const relay = await setRelayState(table, "on"); save(); res.json({ ...enrichTable(table), warning: relay.failed ? "เปิดโต๊ะแล้ว แต่ติดต่อ ESP32 เพื่อเปิด Relay ไม่สำเร็จ" : undefined }); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/tables/:id/pause", requirePermission(PERMISSIONS.TABLE_PAUSE), (req, res) => { try { const session = sessionRepository.findOpenSessionByTable(req.params.id); if (!session) return res.status(409).json({ error: "โต๊ะยังไม่ได้เปิดใช้งาน" }); sessionService.pauseSession(session.id); billingService.audit("TABLE_PAUSED", { tableId: Number(req.params.id), sessionId: session.id, actorId: actorId(req) }); res.json(enrichTable(tableById(req.params.id))); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/tables/:id/resume", requirePermission(PERMISSIONS.TABLE_RESUME), (req, res) => { try { const session = sessionRepository.findOpenSessionByTable(req.params.id); if (!session) return res.status(409).json({ error: "โต๊ะยังไม่ได้เปิดใช้งาน" }); sessionService.resumeSession(session.id); billingService.audit("TABLE_RESUMED", { tableId: Number(req.params.id), sessionId: session.id, actorId: actorId(req) }); res.json(enrichTable(tableById(req.params.id))); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/tables/:id/cancel", async (req, res) => { try { const table = tableById(req.params.id), session = sessionRepository.findOpenSessionByTable(req.params.id); if (!table || !session) return res.status(409).json({ error: "ไม่มี Session ที่ยกเลิกได้" }); sessionService.cancelSession(session.id); billingService.audit("SESSION_CANCELLED", { tableId: table.id, sessionId: session.id }); const relay = await setRelayState(table, "off"); save(); res.json({ table: enrichTable(table), warning: relay.failed ? "ยกเลิก Session แล้ว แต่ติดต่อ ESP32 เพื่อปิด Relay ไม่สำเร็จ" : undefined }); } catch (error) { res.status(409).json({ error: error.message }); } });
app.post("/api/tables/:id/items", (req, res) => { const table = tableById(req.params.id); const product = store.products.find(p => p.id === req.body.productId); if (!table || table.status !== "playing") return res.status(400).json({ error: "โต๊ะยังไม่เปิดใช้งาน" }); if (!product) return res.status(404).json({ error: "ไม่พบสินค้า" }); const existing = table.items.find(i => i.productId === product.id); if (existing) existing.quantity += Number(req.body.quantity) || 1; else table.items.push({ productId: product.id, name: product.name, price: product.price, quantity: Number(req.body.quantity) || 1 }); save(); res.json(enrichTable(table)); });
function createCombinedCheckout(sessionId, paymentMethod, requestActorId, rewardInput={}) {
  const preview=combinedBillingService.buildPreview(sessionId), session=sessionRepository.findSession(sessionId), reward=normalizeRewardRequest({...rewardInput,memberId:rewardInput.memberId??preview.memberId});
  if(shouldRedeem(reward))memberService.previewRedeem(rewardPreviewInput({memberId:reward.memberId,totalSatang:preview.breakdown.totalSatang,saleSource:"TABLE"}),reward.redeemedPoints,settingsService.getSettings());
  let locked=null;
  try {
    const reservationConfig=settingsService.getSettings().reservation, manualRemoval=rewardInput.removeDeposit===true&&reservationConfig.allowManualDepositRemoval;
    locked=depositSettlementService.prepareForSession(session,requestActorId,reservationConfig.autoApplyDeposit&&!manualRemoval);
    const result=combinedBillingService.createBill(sessionId,requestActorId);
    selectBillRewards(result.bill,reward,requestActorId);
    if(locked) depositSettlementService.applyToBill(result.bill,locked,requestActorId);
    const amountSatang=Number.isInteger(result.bill.remainingPaymentSatang)?result.bill.remainingPaymentSatang:result.bill.totalSatang;
    const {payment}=paymentService.createPayment({billId:result.bill.id,method:paymentMethod||"cash",amountSatang,actorId:requestActorId});
    return {...result,payment,deposit:locked};
  } catch(error) {
    if(locked){const current=reservationDepositRepository.findById(locked.id);if(current?.status==="LOCKED")depositSettlementService.unlock(locked.id,requestActorId,current.version,current.lockToken);}
    throw error;
  }
}
app.get("/api/table-sessions/:id/billing-preview", requirePermission(PERMISSIONS.TABLE_CLOSE), (req, res) => { try { const preview=combinedBillingService.buildPreview(req.params.id), session=sessionRepository.findSession(req.params.id), deposit=session?.reservationId?reservationDepositRepository.findByReservationId(session.reservationId):null, applicable=settingsService.getSettings().reservation.autoApplyDeposit&&deposit?.status==="AVAILABLE"?Math.min(deposit.amountSatang,preview.breakdown.totalSatang):0; preview.deposit={reservationId:session?.reservationId||null,depositId:deposit?.id||null,status:deposit?.status||null,depositAppliedSatang:applicable,remainingPaymentSatang:preview.breakdown.totalSatang-applicable}; res.json({preview}); } catch (error) { res.status(error.code === "DUPLICATE_BILL" ? 409 : 400).json({ error: error.code || "BILLING_PREVIEW_ERROR", message: error.message }); } });
app.post("/api/table-sessions/:id/create-bill", requirePermission(PERMISSIONS.TABLE_CLOSE), (req, res) => { try { res.json(createCombinedCheckout(req.params.id, req.body?.paymentMethod, actorId(req), req.body||{})); } catch (error) { if(error.code&&error.code!=="DUPLICATE_BILL")return sendRewardError(res,error); res.status(error.code === "DUPLICATE_BILL" ? 409 : 400).json({ error: error.code || "COMBINED_BILL_ERROR", message: error.message }); } });
app.post("/api/tables/:id/checkout", requirePermission(PERMISSIONS.TABLE_CLOSE), (req, res) => { try { const session = sessionRepository.findOpenSessionByTable(req.params.id); if (!session || !["ACTIVE", "PAUSED"].includes(session.state)) return res.status(400).json({ error: "โต๊ะไม่ได้อยู่ในสถานะที่คิดเงินได้" }); res.json(createCombinedCheckout(session.id, req.body?.paymentMethod, actorId(req), req.body||{})); } catch (error) { if(error.code&&error.code!=="DUPLICATE_BILL")return sendRewardError(res,error); res.status(error.code === "DUPLICATE_BILL" ? 409 : 400).json({ error: error.code || "COMBINED_BILL_ERROR", message: error.message }); } });
app.post("/api/payments/:id/confirm", requirePermission(PERMISSIONS.PAYMENT_CONFIRM), async (req, res) => { let redeemedBill=null; try { const pending=billingRepository.findPayment(req.params.id), pendingBill=pending&&billingRepository.findBill(pending.billId); if(pendingBill?.redeemSelected&&pendingBill.saleSource==="TABLE"){memberService.redeemPoints(pendingBill,actorId(req));redeemedBill=pendingBill;} const { bill, payment } = paymentService.confirmPayment(req.params.id, actorId(req)); memberService.earn(bill,actorId(req),settingsService.getSettings()); const table = tableById(bill.tableId); const session = table && sessionRepository.findOpenSessionByTable(table.id); if (session) sessionService.completeSession(session.id); billingService.audit("SESSION_CLOSED_AFTER_PAYMENT", { tableId: bill.tableId, sessionId: session?.id, billId: bill.id, paymentId: payment.id, actorId: actorId(req) }); const relay = table ? await setRelayState(table, "off") : {}; if (table) sessionRepository.releaseTable(table.id); save(); res.json({ bill, payment, warning: relay.failed ? "ยืนยันชำระแล้ว แต่ติดต่อ ESP32 เพื่อปิด Relay ไม่สำเร็จ" : undefined }); } catch (error) { if(redeemedBill&&redeemedBill.status!=="paid") memberService.rollbackRedeem(redeemedBill,actorId(req)); res.status(409).json({ error: error.message }); } });
app.post("/api/payments/:id/cancel", (req, res) => { try { res.json(paymentService.cancelPayment(req.params.id)); } catch (error) { res.status(409).json({ error: error.message }); } });
app.delete("/api/bills/:id", requirePermission(PERMISSIONS.BILL_VOID), (req, res) => { try { const bill = billingRepository.findBill(req.params.id); if (!bill) return res.status(404).json({ error: "ไม่พบบิลที่ต้องการยกเลิก" }); billingRepository.payments().filter(payment => payment.billId === bill.id && payment.status === "pending").forEach(payment => paymentService.cancelPayment(payment.id)); billingService.voidBill(bill, req.body?.reason, actorId(req)); memberService.rollbackRedeem(bill,actorId(req)); memberService.void(bill,actorId(req)); const restoredPosOrderIds = combinedBillingService.voidCombinedBill(bill, actorId(req)); const table = tableById(bill.tableId); const session = table && sessionRepository.findOpenSessionByTable(table.id); if (session) sessionService.cancelSession(session.id); if (table) sessionRepository.releaseTable(table.id); res.json({ message: `ยกเลิกบิล ${bill.number} แล้ว โดยเก็บประวัติไว้สำหรับตรวจสอบ`, bill, restoredPosOrderIds }); } catch (error) { res.status(409).json({ error: error.message }); } });
const hardwareRoute = action => async (req, res) => { try { res.json(await action(req)); } catch (error) { hardwareController.sendError(res, error); } };
const wizardRoute = action => async (req,res) => { try { res.json(await action(req)); } catch(error) { const body=typeof error.public==="function"?error.public():{code:error.code||"UNKNOWN_ERROR",userMessage:"เกิดข้อผิดพลาดระหว่างตั้งค่า",recoveryMessage:"ลองใหม่ หรือติดต่อผู้ดูแลระบบ",retryable:true};res.status(error.status||500).json({error:body.code,message:body.userMessage,...body}); } };
app.get("/api/hardware/devices", requireHardwareAdmin, (req, res) => res.json({ devices: hardwareService.list().map(device => hardwareHealthMonitoringService.publicDevice(device)) }));
app.post("/api/hardware/health/check-all", requireHardwareAdmin, hardwareRoute(async () => ({ devices: await hardwareHealthMonitoringService.checkAll() })));
app.post("/api/hardware/devices/:id/health/check", requireHardwareAdmin, hardwareRoute(async req => ({ device: await hardwareHealthMonitoringService.check(req.params.id, { manual: true }) })));
app.post("/api/hardware/discovery/start", requireHardwareAdmin, hardwareRoute(req => hardwareDiscoveryService.start(actorId(req))));
app.get("/api/hardware/discovery/:sessionId", requireHardwareAdmin, hardwareRoute(req => hardwareDiscoveryService.get(req.params.sessionId)));
app.delete("/api/hardware/discovery/:sessionId", requireHardwareAdmin, hardwareRoute(req => hardwareDiscoveryService.cancel(req.params.sessionId)));
app.post("/api/hardware/devices/:id/key/enroll", requireHardwareAdmin, hardwareRoute(req => hardwareService.enrollUniqueDeviceKey(req.params.id, actorId(req))));
app.get("/api/hardware/devices/:id/wifi/networks", requireHardwareAdmin, hardwareRoute(req => hardwareWifiProvisioningService.networks(req.params.id)));
app.post("/api/hardware/devices/:id/wifi/start", requireHardwareAdmin, hardwareRoute(req => hardwareWifiProvisioningService.start(req.params.id, req.body || {}, actorId(req))));
app.get("/api/hardware/wifi/:sessionId", requireHardwareAdmin, hardwareRoute(req => hardwareWifiProvisioningService.get(req.params.sessionId)));
app.post("/api/hardware/devices/:id/setup-code/enroll", requireHardwareAdmin, hardwareRoute(req => hardwareSetupModeService.enroll(req.params.id, actorId(req))));
app.post("/api/hardware/devices/:id/setup-code/acknowledge", requireHardwareAdmin, hardwareRoute(req => hardwareSetupModeService.acknowledge(req.params.id, actorId(req))));
app.get("/api/hardware/devices/:id/setup-mode", requireHardwareAdmin, hardwareRoute(req => hardwareSetupModeService.status(req.params.id)));
app.post("/api/hardware/devices/:id/setup-mode/start", requireHardwareAdmin, hardwareRoute(req => hardwareSetupModeService.start(req.params.id, req.body?.confirmed, actorId(req))));
app.post("/api/hardware/devices/:id/setup-mode/stop", requireHardwareAdmin, hardwareRoute(req => hardwareSetupModeService.stop(req.params.id, actorId(req))));
app.get("/api/hardware/devices/:id/wiring", requireHardwareAdmin, hardwareRoute(req => hardwareWiringAssistantService.view(req.params.id)));
app.post("/api/hardware/devices/:id/wiring/session", requireHardwareAdmin, hardwareRoute(req => hardwareWiringAssistantService.start(req.params.id, req.body?.confirmations, actorId(req))));
app.post("/api/hardware/devices/:id/wiring/test", requireHardwareAdmin, hardwareRoute(req => hardwareWiringAssistantService.test(req.params.id, req.body?.sessionId, req.body || {}, actorId(req))));
app.post("/api/hardware/devices/:id/wiring/result", requireHardwareAdmin, hardwareRoute(req => hardwareWiringAssistantService.result(req.params.id, req.body?.sessionId, req.body || {}, actorId(req))));
app.post("/api/hardware/devices/:id/wiring/complete", requireHardwareAdmin, hardwareRoute(req => hardwareWiringAssistantService.complete(req.params.id, req.body?.sessionId, actorId(req))));
app.post("/api/hardware/devices/:id/wiring/cancel", requireHardwareAdmin, hardwareRoute(req => hardwareWiringAssistantService.cancel(req.params.id, req.body?.sessionId, actorId(req))));
app.get("/api/hardware/usb-flasher/csrf", requireHardwareAdmin, requireLoopback, hardwareRoute(req => usbFlasherService.issueCsrf(actorId(req))));
app.get("/api/hardware/usb-flasher/ports", requireHardwareAdmin, requireLoopback, hardwareRoute(() => ({ ports: usbFlasherService.ports() })));
app.post("/api/hardware/usb-flasher/token", requireHardwareAdmin, requireLoopback, hardwareRoute(req => usbFlasherService.issueToken(actorId(req), req.get("x-lucky-csrf"))));
app.post("/api/hardware/usb-flasher/start", requireHardwareAdmin, requireLoopback, hardwareRoute(req => usbFlasherService.start(req.body || {}, actorId(req))));
app.get("/api/hardware/usb-flasher/active", requireHardwareAdmin, requireLoopback, hardwareRoute(req => usbFlasherService.current(actorId(req))));
app.get("/api/hardware/usb-flasher/:operationId", requireHardwareAdmin, requireLoopback, hardwareRoute(req => usbFlasherService.status(req.params.operationId, actorId(req))));
app.post("/api/hardware/usb-flasher/:operationId/enrollment/token", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareEnrollmentHandoffService.issueToken(req.params.operationId, actorId(req))));
app.post("/api/hardware/usb-flasher/:operationId/enrollment/start", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareEnrollmentHandoffService.begin(req.params.operationId, actorId(req), req.get("x-lucky-enrollment-token"))));
app.post("/api/hardware/usb-flasher/:operationId/cancel", requireHardwareAdmin, requireLoopback, hardwareRoute(req => usbFlasherService.cancel(req.params.operationId, actorId(req))));
app.post("/api/hardware/devices/:id/usb-recovery/token", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbRecoveryService.issueToken(req.params.id, actorId(req))));
app.post("/api/hardware/usb-recovery/key-rotation", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbRecoveryService.startKeyRotation(req.body || {}, actorId(req))));
app.post("/api/hardware/usb-recovery/wifi", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbRecoveryService.startWifiRecovery(req.body || {}, actorId(req))));
app.get("/api/hardware/usb-recovery/:operationId", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbRecoveryService.get(req.params.operationId, actorId(req))));
app.post("/api/hardware/usb-recovery/:operationId/vault/retry", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbRecoveryService.retryVault(req.params.operationId, actorId(req))));
app.post("/api/hardware/usb-recovery/:operationId/cancel", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbRecoveryService.cancel(req.params.operationId, actorId(req))));
app.post("/api/hardware/devices/:id/replace", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareService.replaceController(req.params.id, req.body?.replacementRecordId, req.body?.confirmed, actorId(req))));
app.post("/api/hardware/portable/export", requireHardwareAdmin, requireLoopback, hardwareRoute(req => portableMigrationService.exportBundle(actorId(req))));
app.post("/api/hardware/portable/validate", requireHardwareAdmin, requireLoopback, hardwareRoute(req => ({ valid: portableMigrationService.validate(req.body) })));
app.delete("/api/hardware/usb-flasher/:operationId", requireHardwareAdmin, requireLoopback, hardwareRoute(req => usbFlasherService.dismiss(req.params.operationId, actorId(req))));
app.post("/api/hardware/setup/start", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.start(actorId(req))));
app.post("/api/hardware/setup/:draftId/verify", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.verify(req.params.draftId, req.body||{})));
app.post("/api/hardware/setup/:draftId/authenticate", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.authenticate(req.params.draftId, req.body||{})));
app.post("/api/hardware/setup/:draftId/usb-adoption/token", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbAdoptionService.issueToken(req.params.draftId, req.body?.port, actorId(req), tokenFromRequest(req))));
app.post("/api/hardware/setup/:draftId/usb-adoption/start", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbAdoptionService.start(req.params.draftId, req.body || {}, actorId(req), tokenFromRequest(req))));
app.get("/api/hardware/usb-adoption/:operationId", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbAdoptionService.get(req.params.operationId, actorId(req), tokenFromRequest(req))));
app.post("/api/hardware/usb-adoption/:operationId/retry", requireHardwareAdmin, requireLoopback, hardwareRoute(req => hardwareUsbAdoptionService.retry(req.params.operationId, actorId(req), tokenFromRequest(req))));
app.post("/api/hardware/setup/:draftId/relays/:channel/test", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.testRelay(req.params.draftId,{channel:req.params.channel,durationMs:req.body?.durationMs})));
app.post("/api/hardware/setup/:draftId/relays/all/off", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.emergencyOff(req.params.draftId)));
app.post("/api/hardware/setup/:draftId/skip", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.skip(req.params.draftId,req.body?.channels)));
app.post("/api/hardware/setup/:draftId/naming", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.naming(req.params.draftId)));
app.post("/api/hardware/setup/:draftId/save", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.save(req.params.draftId,req.body||{},actorId(req))));
app.delete("/api/hardware/setup/:draftId", requireHardwareAdmin, wizardRoute(req => hardwareSetupWizardService.cancel(req.params.draftId)));
app.post("/api/hardware/devices/test-connection", requireHardwareAdmin, hardwareRoute(req => hardwareService.testCandidate(req.body || {})));
app.post("/api/hardware/devices", requireHardwareAdmin, async (req, res) => { try { res.status(201).json({ device: await hardwareService.create(req.body || {}, actorId(req)) }); } catch (error) { hardwareController.sendError(res, error); } });
app.put("/api/hardware/devices/:id", requireHardwareAdmin, hardwareRoute(async req => ({ device: await hardwareService.update(req.params.id, req.body || {}, actorId(req)) })));
app.delete("/api/hardware/devices/:id", requireHardwareAdmin, hardwareRoute(req => { hardwareService.delete(req.params.id, actorId(req)); return { deleted: true }; }));
app.post("/api/hardware/devices/:id/test", requireHardwareAdmin, hardwareRoute(async req => ({ device: await hardwareService.refresh(req.params.id) })));
app.post("/api/hardware/devices/:id/restart", requireHardwareAdmin, hardwareRoute(req => hardwareService.restart(req.params.id)));
app.get("/api/hardware/devices/:id/health", requireHardwareAdmin, hardwareRoute(req => hardwareHealthMonitoringService.check(req.params.id)));
app.get("/api/hardware/devices/:id/relays", requireHardwareAdmin, hardwareRoute(req => hardwareService.relays(req.params.id)));
app.post("/api/hardware/devices/:id/relays/all/off", requireHardwareAdmin, hardwareRoute(req => hardwareService.allOff(req.params.id)));
app.post("/api/hardware/devices/:id/relays/:relayId/state", requireHardwareAdmin, hardwareRoute(req => { if (typeof req.body?.state !== "boolean") { const error = new Error("state ต้องเป็น true หรือ false"); error.code = "INVALID_RELAY_STATE"; error.status = 400; throw error; } return hardwareService.relayState(req.params.id, req.params.relayId, req.body.state); }));
app.get("/api/hardware/devices/:id/config/relay", requireHardwareAdmin, hardwareRoute(req => hardwareService.relayConfig(req.params.id)));
app.post("/api/hardware/devices/:id/config/relay", requireHardwareAdmin, hardwareRoute(req => hardwareService.setRelayCount(req.params.id, req.body?.relayCount, actorId(req), typeof req.body?.activeHigh === "boolean" ? req.body.activeHigh : undefined)));
app.put("/api/hardware/tables/:tableId/relay", requireHardwareAdmin, hardwareRoute(req => ({ mapping: hardwareService.mapTable(req.params.tableId, req.body?.deviceId, req.body?.relayChannel, actorId(req)) })));
app.post("/api/relay/:tableId", async (req, res) => { const table = tableById(req.params.tableId); if (!table) return res.status(404).json({ error: "ไม่พบโต๊ะ" }); const state = req.body.state === "on" ? "on" : "off"; const relay = await setRelayState(table, state); save(); if (relay.failed) return res.status(relay.code === "DEVICE_OFFLINE" ? 503 : 409).json({ error: relay.code, message: relay.message }); res.json({ table: enrichTable(table), message: "ส่งคำสั่ง Relay ผ่าน Hardware Manager แล้ว" }); });
app.get("/api/reports/summary", (req, res) => { const date = req.query.date || new Date().toISOString().slice(0, 10); const bills = store.bills.filter(b => b.status === "paid" && b.createdAt.startsWith(date)); const sum = key => bills.reduce((s, b) => s + (b[key] || 0), 0); res.json({ date, billCount: bills.length, revenue: sum("total"), tableRevenue: sum("playAmount"), posRevenue: sum("foodAmount"), bills }); });
app.get("/api/reports/analytics", (req, res) => {
  const type = req.query.type === "year" ? "year" : "month";
  const now = new Date();
  const period = req.query.period || (type === "year" ? String(now.getFullYear()) : now.toISOString().slice(0, 7));
  const partCache=new Map(),part=date=>{const key=String(date);if(partCache.has(key))return partCache.get(key);const shifted=new Date(new Date(date).getTime()+7*60*60*1000),value={year:String(shifted.getUTCFullYear()),month:String(shifted.getUTCMonth()+1).padStart(2,"0"),day:String(shifted.getUTCDate()).padStart(2,"0"),hour:String(shifted.getUTCHours()).padStart(2,"0")};partCache.set(key,value);return value;};
  const dateKey = bill => { const p = part(bill.createdAt); return `${p.year}-${p.month}-${p.day}`; };
  const periodKey = bill => { const p = part(bill.createdAt); return type === "year" ? p.year : `${p.year}-${p.month}`; };
  const bills = store.bills.filter(b => b.status === "paid" && periodKey(b) === period);
  const sum = key => Number(bills.reduce((s, b) => s + (b[key] || 0), 0).toFixed(2));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, bills: 0, revenue: 0 }));
  const weekdays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"].map(name => ({ name, bills: 0, revenue: 0 }));
  const daily = {};
  const products = {}, members = {};
  bills.forEach(b => { const p = part(b.createdAt); const hour = Number(p.hour); const day = new Date(`${p.year}-${p.month}-${p.day}T12:00:00+07:00`).getDay(); hours[hour].bills++; hours[hour].revenue += b.total; weekdays[day].bills++; weekdays[day].revenue += b.total; const key = dateKey(b); daily[key] = (daily[key] || 0) + b.total; if(b.memberId){const m=members[b.memberId]||{memberId:b.memberId,memberCode:b.memberCode||null,name:b.memberName||"-",revenue:0,visits:0};m.revenue+=Number(b.total||0);m.visits++;members[b.memberId]=m;}(b.items || []).forEach(item => { const x = products[item.name] || { name: item.name, quantity: 0, revenue: 0 }; x.quantity += item.quantity; x.revenue += item.total; products[item.name] = x; }); });
  const top = list => list.reduce((best, item) => item.bills > best.bills || (item.bills === best.bills && item.revenue > best.revenue) ? item : best, { bills: 0, revenue: 0 });
  const memberRevenue=bills.filter(b=>b.memberId).reduce((total,b)=>total+Number(b.total||0),0), points=(store.memberPointTransactions||[]).filter(tx=>periodKey({createdAt:tx.createdAt})===period), newMembers=(store.members||[]).filter(member=>periodKey({createdAt:member.createdAt||""})===period).length, redeemers={}; bills.forEach(b=>{if(!b.memberId||!b.redeemedPoints)return;const x=redeemers[b.memberId]||{memberId:b.memberId,memberCode:b.memberCode||null,name:b.memberName||"-",points:0,discount:0};x.points+=Number(b.redeemedPoints||0);x.discount+=Number(b.redeemValue||0);redeemers[b.memberId]=x;});
  res.json({ type, period, billCount: bills.length, revenue: sum("total"), tableRevenue: sum("playAmount"), posRevenue: sum("foodAmount"), averageBill: bills.length ? Number((sum("total") / bills.length).toFixed(2)) : 0, peakHour: top(hours), peakWeekday: top(weekdays), hours, weekdays, daily: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, revenue]) => ({ date, revenue })), topProducts: Object.values(products).sort((a, b) => b.revenue - a.revenue).slice(0, 10), memberRevenue, nonMemberRevenue:Number((sum("total")-memberRevenue).toFixed(2)), topMembersBySpend:Object.values(members).sort((a,b)=>b.revenue-a.revenue).slice(0,10), topMembersByVisit:Object.values(members).sort((a,b)=>b.visits-a.visits).slice(0,10), pointsEarned:points.filter(tx=>tx.type==="EARN").reduce((total,tx)=>total+Number(tx.points||0),0), pointsVoided:Math.abs(points.filter(tx=>tx.type==="VOID").reduce((total,tx)=>total+Number(tx.points||0),0)), pointsExpired:Math.abs(points.filter(tx=>tx.type==="EXPIRE").reduce((total,tx)=>total+Number(tx.points||0),0)), redeemedPoints:bills.reduce((total,b)=>total+Number(b.redeemedPoints||0),0), rewardDiscount:bills.reduce((total,b)=>total+Number(b.redeemValue||0),0), outstandingPoints:(store.members||[]).reduce((total,m)=>total+Number(m.points||0),0), topRedeemers:Object.values(redeemers).sort((a,b)=>b.points-a.points).slice(0,10), newMembers });
});
app.get("/api/integrity", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req,res)=>res.json(integrityCheckService.run()));
app.get("/api/health", requirePermission(PERMISSIONS.SETTINGS_MANAGE), (req,res)=>res.json(healthService.status()));
app.use("/api", (req, res) => res.status(404).json({ error: "API route not found", path: req.originalUrl }));
app.use(express.static(path.join(__dirname, "public")));
app.use((error,req,res,next)=>{operationalLog("ERROR","EXPRESS_ERROR",{requestId:req.requestId,userId:req.user?.userId||null,route:req.originalUrl.split("?")[0],errorCode:error.type||error.code||"UNHANDLED",durationMs:0});if(res.headersSent)return next(error);res.status(error.type==="entity.parse.failed"?400:500).json({error:error.type==="entity.parse.failed"?"INVALID_JSON":"INTERNAL_ERROR",message:error.type==="entity.parse.failed"?"รูปแบบ JSON ไม่ถูกต้อง":"ระบบไม่สามารถดำเนินการได้"});});

const reservationTimer = setInterval(() => reservationService.processDue().catch(error => console.error("Reservation lifecycle error", error)), 30000);
reservationTimer.unref();
const pointExpiryTimer = setInterval(() => { try { if (memberService.sweepAllExpiredPoints(settingsService.getSettings()).length) save(); } catch (error) { console.error("Point expiry sweep error", error); } }, 6 * 60 * 60 * 1000);
pointExpiryTimer.unref();
hardwareHealthMonitoringService.start();
process.on("unhandledRejection",error=>operationalLog("ERROR","UNHANDLED_REJECTION",{errorCode:error?.code||"UNHANDLED_REJECTION",message:error?.message||String(error)}));
process.on("uncaughtException",error=>{operationalLog("ERROR","UNCAUGHT_EXCEPTION",{errorCode:error?.code||"UNCAUGHT_EXCEPTION",message:error?.message||String(error)});process.exitCode=1;shutdown("UNCAUGHT_EXCEPTION");});
const server=app.listen(PORT,HOST,()=>operationalLog("INFO","SERVER_STARTED",{port:Number(server.address().port),host:HOST||"DEFAULT",nodeVersion:process.version,pid:process.pid,dataMode:dataLayout.legacyDevelopmentMode?"LEGACY_DEVELOPMENT":"CUSTOMER_DATA"}));
let shuttingDown=false;
function waitForJsonWrites(timeoutMs=9000){const deadline=Date.now()+timeoutMs;return new Promise(resolve=>{const inspect=()=>{if(activeJsonWrites().length===0||Date.now()>=deadline)return resolve(activeJsonWrites().length===0);setTimeout(inspect,25);};inspect();});}
function shutdown(signal){if(shuttingDown)return;shuttingDown=true;operationalLog("INFO","SERVER_SHUTDOWN",{signal,uptimeSeconds:Math.floor(process.uptime())});clearInterval(reservationTimer);hardwareHealthMonitoringService.stop();server.close(async()=>{const writesFlushed=await waitForJsonWrites(9000);operationalLog(writesFlushed?"INFO":"ERROR","SERVER_STOPPED",{signal,writesFlushed});process.exit(writesFlushed?(process.exitCode||0):1);});setTimeout(()=>process.exit(process.exitCode||1),10000).unref();}
process.on("SIGINT",()=>shutdown("SIGINT"));
process.on("SIGTERM",()=>shutdown("SIGTERM"));
