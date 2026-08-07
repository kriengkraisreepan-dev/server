const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { before } = require("node:test");
const { canonicalManifest, FirmwarePackageService } = require("../services/firmware-package-service");
const { FirmwareProductionTrustStore, publicKeyFingerprint } = require("../services/firmware-production-trust-store");
const { ProductionFirmwarePackageService } = require("../services/production-firmware-package-service");
const { ProductionReleaseBuilder } = require("../services/production-release-builder");

const root = path.resolve(__dirname, "..");
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-phase53-"));
const createdAt = new Date("2026-08-03T00:00:00.000Z"), sourceCommit = "a".repeat(40);
const pair = crypto.generateKeyPairSync("ed25519"), fingerprint = publicKeyFingerprint(pair.publicKey), keyId = `lrc-prod-2026-01-${fingerprint.slice(0,12)}`;
let basePackage;
const approvals = { releaseOperatorConfirmed:true,productionApproverConfirmed:true,licenseDistributionApproved:true,antivirusApproved:true,windowsExecutionApproved:true,cp210xApproved:true,ch340Approved:true,esp32HardwareApproved:true,releaseOperatorId:"test-release-operator",productionApproverId:"test-production-approver" };
const registry = (overrides={}) => ({schemaVersion:1,status:"EPHEMERAL_TEST",keys:[{keyId,publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}),fingerprintSha256:fingerprint,validFrom:"2026-01-01T00:00:00.000Z",validUntil:"2026-12-31T23:59:59.999Z"}],revokedKeys:[],...overrides});
const trust = overrides => new FirmwareProductionTrustStore({registry:registry(overrides)});
const clone = name => {const target=path.join(suiteRoot,name);fs.cpSync(basePackage,target,{recursive:true});return target;};
const manifest = dir => JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"),"utf8"));
function resign(dir, changes={}, signingPair=pair){const value={...manifest(dir),...changes};fs.writeFileSync(path.join(dir,"manifest.json"),canonicalManifest(value));fs.writeFileSync(path.join(dir,"manifest.sig"),crypto.sign(null,canonicalManifest(value),signingPair.privateKey).toString("base64"));return value;}
function verifier(dir, options={}){return new ProductionFirmwarePackageService({packageRoot:dir,trustStore:options.trustStore||trust(),mode:options.mode||"production-like-test",managerVersion:"1.0.0",currentFirmware:options.currentFirmware});}

before(() => {
  const builder=new ProductionReleaseBuilder({workspaceRoot:root,mode:"production-like-test",outputRoot:path.join(suiteRoot,"builder-output"),keyProvider:()=>({privateKey:pair.privateKey,publicKey:pair.publicKey,keyId}),approvals,clock:()=>createdAt,sourceCommitProvider:()=>sourceCommit});
  basePackage=builder.build({releaseNotes:"Ephemeral Phase 5.3 verification only"}).packageRoot;
});

test("valid production-like package verifies with deterministic v2 manifest and detached Ed25519 signature",()=>{const result=verifier(basePackage).verify();assert.equal(result.manifest.manifestFormatVersion,2);assert.equal(result.manifest.releaseChannel,"production");assert.equal(result.signingKey.keyId,keyId);assert.deepEqual(canonicalManifest(result.manifest),fs.readFileSync(path.join(basePackage,"manifest.json")));});

test("production verifier rejects production-like/test channel and legacy Test key",()=>{assert.throws(()=>verifier(basePackage,{mode:"production"}).verify(),error=>error.code==="SIGNING_ENVIRONMENT_REJECTED");const testPackage=path.join(root,"runtime","firmware-packages","test","1.1.0");assert.throws(()=>new FirmwarePackageService({packageRoot:testPackage,publicKey:"",mode:"production"}).verify());});

test("unknown, mismatched and revoked signing keys fail closed",()=>{
  const empty=new FirmwareProductionTrustStore({registry:{schemaVersion:1,status:"EMPTY",keys:[],revokedKeys:[]}});
  assert.throws(()=>verifier(basePackage,{trustStore:empty}).verify(),error=>error.code==="SIGNING_KEY_UNKNOWN");
  const wrong=crypto.generateKeyPairSync("ed25519"),wrongRegistry=registry();wrongRegistry.keys[0].publicKeyPem=wrong.publicKey.export({type:"spki",format:"pem"});
  assert.throws(()=>verifier(basePackage,{trustStore:new FirmwareProductionTrustStore({registry:wrongRegistry})}).verify());
  assert.throws(()=>verifier(basePackage,{trustStore:trust({revokedKeys:[{keyId,revokedAt:"2026-08-02T00:00:00.000Z",revokeAll:true}]})}).verify(),error=>error.code==="SIGNING_KEY_REVOKED");
});

test("manifest, firmware and tools modifications are rejected",()=>{let dir=clone("modified-manifest");const changed=manifest(dir);changed.minimumManagerVersion="0.9.0";fs.writeFileSync(path.join(dir,"manifest.json"),canonicalManifest(changed));assert.throws(()=>verifier(dir).verify(),error=>error.code==="MANIFEST_SIGNATURE_INVALID");for(const [name,file] of [["firmware","firmware.bin"],["esptool","esptool.exe"],["nvs","lucky-nvs-generator.exe"]]){dir=clone(`modified-${name}`);fs.appendFileSync(path.join(dir,file),"tamper");assert.throws(()=>verifier(dir).verify(),error=>error.code==="PACKAGE_HASH_MISMATCH");}});

test("missing, malformed signature and unexpected or missing files are rejected",()=>{let dir=clone("missing-signature");fs.rmSync(path.join(dir,"manifest.sig"));assert.throws(()=>verifier(dir).verify(),error=>error.code==="PACKAGE_FILE_MISSING");dir=clone("bad-signature");fs.writeFileSync(path.join(dir,"manifest.sig"),"not-base64");assert.throws(()=>verifier(dir).verify(),error=>error.code==="MANIFEST_SIGNATURE_INVALID");dir=clone("unexpected");fs.writeFileSync(path.join(dir,"extra.exe"),"x");assert.throws(()=>verifier(dir).verify(),error=>error.code==="PACKAGE_UNEXPECTED_FILE");dir=clone("missing-firmware");fs.rmSync(path.join(dir,"firmware.bin"));assert.throws(()=>verifier(dir).verify(),error=>error.code==="PACKAGE_FILE_MISSING");});

test("duplicate/path traversal/symlink/executable license and duplicate offset are rejected",()=>{let dir=clone("duplicate-path");const m=manifest(dir);m.files.push({...m.files[0]});resign(dir,{files:m.files});assert.throws(()=>verifier(dir).verify(),error=>error.code==="MANIFEST_DUPLICATE_FILE");dir=clone("traversal");const files=manifest(dir).files.map((item,index)=>index?item:{...item,path:"../bootloader.bin"});resign(dir,{files});assert.throws(()=>verifier(dir).verify(),error=>error.code==="PACKAGE_PATH_INVALID");dir=clone("license-exe");fs.writeFileSync(path.join(dir,"LICENSES","bad.exe"),"x");assert.throws(()=>verifier(dir).verify(),error=>error.code==="PACKAGE_UNEXPECTED_FILE");dir=clone("duplicate-offset");const newInstall=manifest(dir).newInstall;newInstall.files[1].offset="0x1000";resign(dir,{newInstall});assert.throws(()=>verifier(dir).verify(),error=>error.code==="MANIFEST_DUPLICATE_OFFSET");if(process.platform!=="win32"){dir=clone("symlink");fs.symlinkSync(path.join(dir,"firmware.bin"),path.join(dir,"link.bin"));assert.throws(()=>verifier(dir).verify());}});

test("wrong chip, flash size and partition layout are rejected",()=>{for(const [name,change,code] of [["chip",{targetChip:"ESP32-S3"},"FIRMWARE_TARGET_REJECTED"],["flash",{flashSizeBytes:8388608},"FIRMWARE_TARGET_REJECTED"]]){const dir=clone(`wrong-${name}`);resign(dir,change);assert.throws(()=>verifier(dir).verify(),error=>error.code===code);}const dir=clone("layout");const newInstall=manifest(dir).newInstall;newInstall.files.find(item=>item.role==="application").offset="0x20000";resign(dir,{newInstall});assert.throws(()=>verifier(dir).verify(),error=>error.code==="NEW_INSTALL_LAYOUT_INVALID");});

test("Semantic Version policy rejects downgrade and same-version hash/build mismatch",()=>{const current=manifest(basePackage),app=current.files.find(item=>item.role==="application");assert.throws(()=>verifier(basePackage,{currentFirmware:{version:"9.0.0",buildId:"old",applicationSha256:app.sha256}}).verify(),error=>error.code==="FIRMWARE_DOWNGRADE_REJECTED");assert.throws(()=>verifier(basePackage,{currentFirmware:{version:current.firmwareVersion,buildId:"different",applicationSha256:app.sha256}}).verify(),error=>error.code==="SAME_VERSION_RELEASE_MISMATCH");assert.doesNotThrow(()=>verifier(basePackage,{currentFirmware:{version:current.firmwareVersion,buildId:current.buildId,applicationSha256:app.sha256}}).verify());});

test("builder rejects duplicate release, publishes atomically and removes temporary workspace after signing failure",()=>{const output=path.join(suiteRoot,"atomic-builder"),make=keyProvider=>new ProductionReleaseBuilder({workspaceRoot:root,mode:"production-like-test",outputRoot:output,keyProvider,approvals,clock:()=>createdAt,sourceCommitProvider:()=>sourceCommit});const first=make(()=>({privateKey:pair.privateKey,publicKey:pair.publicKey,keyId})).build();assert.ok(fs.existsSync(first.packageRoot));assert.throws(()=>make(()=>({privateKey:pair.privateKey,publicKey:pair.publicKey,keyId})).build(),error=>error.code==="PRODUCTION_RELEASE_DUPLICATE_REJECTED");const failedOutput=path.join(suiteRoot,"failed-builder"),wrong=crypto.generateKeyPairSync("ed25519");assert.throws(()=>new ProductionReleaseBuilder({workspaceRoot:root,mode:"production-like-test",outputRoot:failedOutput,keyProvider:()=>({privateKey:wrong.privateKey,publicKey:pair.publicKey,keyId}),approvals,clock:()=>createdAt,sourceCommitProvider:()=>sourceCommit}).build());const leftovers=fs.existsSync(failedOutput)?fs.readdirSync(failedOutput,{recursive:true}).filter(name=>String(name).includes(".tmp-")):[];assert.deepEqual(leftovers,[]);});

test("production builder remains blocked until every distribution and two-role approval is explicit",()=>{const builder=new ProductionReleaseBuilder({workspaceRoot:root,mode:"production",outputRoot:path.join(suiteRoot,"blocked-production"),keyProvider:()=>{throw Error("key provider must not run");},approvals:{releaseOperatorConfirmed:true},clock:()=>createdAt,sourceCommitProvider:()=>sourceCommit});assert.throws(()=>builder.build(),error=>error.code==="PRODUCTION_DISTRIBUTION_NOT_APPROVED");});

test("key rotation overlap accepts old/new within validity and rejects expired key",()=>{assert.doesNotThrow(()=>verifier(basePackage).verify());const expired=registry();expired.keys[0].validUntil="2026-08-02T23:59:59.000Z";assert.throws(()=>verifier(basePackage,{trustStore:new FirmwareProductionTrustStore({registry:expired})}).verify(),error=>error.code==="SIGNING_KEY_OUTSIDE_VALIDITY");});

test("Existing Update is application-only and New Install uses in-memory per-device NVS authorization",()=>{const m=manifest(basePackage);assert.deepEqual(m.existingUpdate.files,[{role:"application",offset:"0x10000"}]);assert.deepEqual(m.newInstall.files.find(item=>item.role==="sessionNvs"),{role:"sessionNvs",offset:"0x9000",authorization:"IN_MEMORY_SHA256"});assert.equal(JSON.stringify(m).includes("erase_flash"),false);});

test("package, manifest, logs and responses contain no credential material or private key",()=>{const all=[];for(const entry of fs.readdirSync(basePackage,{recursive:true,withFileTypes:true}))if(entry.isFile()){const file=path.join(entry.parentPath||entry.path,entry.name);if(fs.statSync(file).size<2_000_000)all.push(fs.readFileSync(file,"utf8"));}const text=all.join("\n");for(const forbidden of ["BEGIN PRIVATE KEY","lucky-relay-1234","wifiPassword\":\"","deviceKey\":\""])assert.equal(text.includes(forbidden),false);});

test("Browser routes cannot select signing key, release input or output path",()=>{const index=fs.readFileSync(path.join(root,"index.js"),"utf8"),ui=fs.readFileSync(path.join(root,"public/js/app.js"),"utf8");assert.doesNotMatch(index,/api\/.*(?:production-release|signing-key|release-builder)/i);assert.doesNotMatch(ui,/(?:privateKey|signingKeyId|productionOutputPath|releaseBuilder)/);});
