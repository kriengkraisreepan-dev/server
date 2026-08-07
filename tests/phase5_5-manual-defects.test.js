const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { BackupExportService } = require("../services/backup-export-service");
const { HardwareSetupWizardService } = require("../services/hardware-setup-wizard-service");

const root = path.resolve(__dirname, "..");
function makeBackup(directory, name = "backup-2026-08-05T10-00-00-000Z.json") {
  const files = { "store.json": { settings:{},tables:[],members:[],products:[],bills:[],payments:[] }, "reservations.json": [], "reservation-deposits.json": [] };
  const checksum = crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const file = path.join(directory, "backups", name); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ formatVersion: 2, metadata: { checksum, verificationStatus: "VERIFIED" }, files })); return file;
}

test("VERIFIED backup exports atomically with matching size and SHA-256", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lucky export ไทย ")), source = makeBackup(dataRoot), destinationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "Lucky ปลายทาง ")), destination = path.join(destinationRoot, path.basename(source));
  const service = new BackupExportService({ backupDirectory: path.join(dataRoot, "backups"), dataRoot });
  const before = fs.readFileSync(source), result = service.export(path.basename(source), destination);
  assert.equal(result.status, "SAVED"); assert.deepEqual(fs.readFileSync(destination), before); assert.deepEqual(fs.readFileSync(source), before);
  assert.equal(result.sha256, crypto.createHash("sha256").update(before).digest("hex")); assert.equal(result.size, before.length);
  assert.equal(fs.readdirSync(destinationRoot).some(name => name.endsWith(".tmp")), false);
});

test("backup exporter rejects traversal, absolute, UNC, ADS, invalid JSON, secret material and symlink", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-export-")), backups = path.join(dataRoot, "backups"), service = new BackupExportService({ backupDirectory: backups, dataRoot }); makeBackup(dataRoot);
  for (const name of ["../backup-x.json", "C:\\backup-x.json", "\\\\server\\backup-x.json", "backup-x.json:stream", "bad.json"]) assert.throws(() => service.inspect(name));
  fs.writeFileSync(path.join(backups, "backup-2026-01-01T00-00-00-000Z.json"), "{"); assert.throws(() => service.inspect("backup-2026-01-01T00-00-00-000Z.json"), /ตรวจสอบ/);
  fs.writeFileSync(path.join(backups, "backup-2026-01-02T00-00-00-000Z.json"), JSON.stringify({ apiKey: "secret" })); assert.throws(() => service.inspect("backup-2026-01-02T00-00-00-000Z.json"), /ไม่อนุญาต/);
  try { fs.symlinkSync(path.join(backups, "backup-2026-08-05T10-00-00-000Z.json"), path.join(backups, "backup-2026-01-03T00-00-00-000Z.json")); assert.throws(() => service.inspect("backup-2026-01-03T00-00-00-000Z.json")); } catch (error) { if (error.code !== "EPERM") throw error; }
});

test("Electron backup IPC is fixed, sender-guarded and renderer no longer opens backup window", () => {
  const main=fs.readFileSync(path.join(root,"electron/main.js"),"utf8"),preload=fs.readFileSync(path.join(root,"electron/preload.js"),"utf8"),ui=fs.readFileSync(path.join(root,"public/js/app.js"),"utf8");
  assert.match(main,/showSaveDialog/); assert.match(main,/validateSender\(event, origin\)/); assert.match(main,/Object\.keys\(request\)\.length !== 1/);
  assert.match(preload,/exportBackup: fileName/); assert.doesNotMatch(preload,/\brequire\(["'](?:fs|path|child_process)["']\)/);
  assert.doesNotMatch(ui,/window\.open\(`\/api\/backups/); assert.match(ui,/luckyDesktop\?\.exportBackup/);
});

test("Generic Wizard uses vault record and rejects Browser credentials without Relay mutation", async () => {
  const calls=[],record={id:"hw-1",deviceId:"LRC-UNIQUE",apiKey:"vault-secret",relayCount:4,credentialStatus:"AUTHENTICATED"};
  const hardwareService={repository:{secretVault:{},list:()=>[record]}},driver={verifyDevice:async device=>{calls.push(device);return{success:true,verified:true,deviceId:"LRC-UNIQUE",identityMigrationVersion:0,previousDeviceId:null};}};
  const wizard=new HardwareSetupWizardService({driver,hardwareService}); wizard.drafts.set("draft",{id:"draft",verification:{deviceId:"LRC-UNIQUE",relayCount:4,identityMigrationVersion:0,previousDeviceId:null},candidate:{ipAddress:"192.168.1.10",port:80},testedChannels:[],skippedChannels:[]});
  await assert.rejects(()=>wizard.authenticate("draft",{apiKey:"browser-key",confirmedDeviceAccess:true}),{code:"AUTHENTICATION_REQUEST_REJECTED"});
  const result=await wizard.authenticate("draft",{confirmedDeviceAccess:true}); assert.equal(result.authenticationVerified,true); assert.equal(calls[0].apiKey,"vault-secret");
  assert.equal(calls.some(call=>"channel" in call||"state" in call),false);
});

test("Wizard runtime removes Device Key DOM and request payload", () => {
  const fix=fs.readFileSync(path.join(root,"public/js/phase5_5-defect-fix.js"),"utf8"),html=fs.readFileSync(path.join(root,"public/index.html"),"utf8");
  assert.match(html,/phase5_5-defect-fix\.js/); assert.match(fix,/secret\.remove\(\)/); assert.doesNotMatch(fix,/apiKey|secretId|localStorage|sessionStorage|lucky-relay-1234/i);
  assert.match(fix,/JSON\.stringify\(\{ confirmedDeviceAccess, confirmedLegacyMigration \}\)/);
});

test("missing, ambiguous and reauthentication records fail closed to USB", async () => {
  for (const records of [[],[{deviceId:"LRC-X",apiKey:"a"},{deviceId:"LRC-X",apiKey:"b"}],[{deviceId:"LRC-X",credentialStatus:"REAUTHENTICATION_REQUIRED"}]]) {
    const wizard=new HardwareSetupWizardService({driver:{},hardwareService:{repository:{secretVault:{},list:()=>records}}}); wizard.drafts.set("d",{id:"d",verification:{deviceId:"LRC-X",relayCount:4},candidate:{}});
    await assert.rejects(()=>wizard.authenticate("d",{confirmedDeviceAccess:true}),error=>["USB_REAUTHENTICATION_REQUIRED","DEVICE_ID_AMBIGUOUS"].includes(error.code));
  }
});
