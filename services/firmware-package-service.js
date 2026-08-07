const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

class FlasherError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}
function canonicalManifest(manifest) { const copy={...manifest};delete copy.signature;return Buffer.from(JSON.stringify(stableValue(copy))); }
function normalizeOffset(value) { if (!/^0x[0-9a-f]+$/i.test(String(value||""))) throw new FlasherError("MANIFEST_OFFSET_INVALID","Firmware offset ไม่ถูกต้อง",500); return `0x${Number.parseInt(String(value),16).toString(16)}`; }

class FirmwarePackageService {
  constructor({ packageRoot, publicKey, trustStore, mode = process.env.NODE_ENV === "production" ? "production" : "test", readFile = fs.readFileSync, managerVersion = "1.0.0", currentFirmware } = {}) {
    this.packageRoot=path.resolve(packageRoot||path.join(__dirname,"..","resources","usb-flasher"));this.publicKey=publicKey||process.env.LUCKY_FIRMWARE_PUBLIC_KEY||"";this.trustStore=trustStore;this.mode=mode;this.readFile=readFile;this.managerVersion=managerVersion;this.currentFirmware=currentFirmware;
  }
  contained(relative) { if(!relative||path.isAbsolute(relative))throw new FlasherError("PACKAGE_PATH_INVALID","Firmware package path ไม่ถูกต้อง",500);const resolved=path.resolve(this.packageRoot,relative);if(resolved!==this.packageRoot&&!resolved.startsWith(`${this.packageRoot}${path.sep}`))throw new FlasherError("PACKAGE_PATH_INVALID","Firmware package อยู่นอกพื้นที่ที่อนุญาต",500);return resolved; }
  bytes(relative, missingCode="PACKAGE_FILE_MISSING") { try { const file=this.contained(relative),real=fs.realpathSync(file),root=fs.realpathSync(this.packageRoot);if(real!==root&&!real.startsWith(`${root}${path.sep}`))throw new Error("escape");return {file,bytes:this.readFile(file)}; } catch { throw new FlasherError(missingCode,`ไม่พบหรือไม่อนุญาตไฟล์ ${path.basename(relative||"")}`,503); } }
  verifyHash(entry) { if(!entry||!/^[a-f0-9]{64}$/i.test(entry.sha256||""))throw new FlasherError("MANIFEST_INVALID","SHA-256 ใน manifest ไม่ถูกต้อง",500);const loaded=this.bytes(entry.file);const actual=crypto.createHash("sha256").update(loaded.bytes).digest("hex");if(!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(entry.sha256.toLowerCase())))throw new FlasherError("PACKAGE_HASH_MISMATCH",`ไฟล์ ${path.basename(entry.file)} ไม่ผ่านการตรวจสอบ`,409);return loaded.file; }
  verify() {
    let manifest;try{manifest=JSON.parse(this.bytes("manifest.json","FIRMWARE_PACKAGE_MISSING").bytes);}catch(error){if(error instanceof FlasherError)throw error;throw new FlasherError("MANIFEST_INVALID","Firmware manifest ไม่ถูกต้อง",500);}
    if(manifest.manifestFormatVersion===2){const {ProductionFirmwarePackageService}=require("./production-firmware-package-service");return new ProductionFirmwarePackageService({packageRoot:this.packageRoot,trustStore:this.trustStore,mode:this.mode==="production"?"production":"production-like-test",managerVersion:this.managerVersion,currentFirmware:this.currentFirmware}).verify();}
    const modern=manifest.manifestFormatVersion===1;
    if(!modern)return this.verifyLegacy(manifest);
    const required=["product","firmwareVersion","buildId","releaseChannel","signingEnvironment","targetChip","boardProfile","flashSizeBytes","flashMode","flashFrequency","esptool","nvsGenerator","nvsPolicy","existingUpdate","newInstall","distributionAssets"];
    if(required.some(key=>manifest[key]===undefined))throw new FlasherError("MANIFEST_INVALID","Firmware manifest ไม่ครบถ้วน",500);
    if(this.mode==="production"&&(manifest.releaseChannel!=="production"||manifest.signingEnvironment!=="production"))throw new FlasherError("TEST_PACKAGE_REJECTED","Production mode ปฏิเสธ Test Package",409);
    if(this.mode==="test"&&(manifest.releaseChannel!=="test"||manifest.signingEnvironment!=="test"))throw new FlasherError("RELEASE_CHANNEL_REJECTED","อนุญาตเฉพาะ Test Package",409);
    if(this.mode==="internal-test"&&(manifest.releaseChannel!=="internal-test"||manifest.signingEnvironment!=="internal-test"))throw new FlasherError("RELEASE_CHANNEL_REJECTED","อนุญาตเฉพาะ Internal Test Package",409);
    if(this.mode==="internal-test"&&(!manifest.packageId||manifest.apiVersion!=="1"||JSON.stringify(manifest.supportedRelayCounts)!=="[2,4,8]"))throw new FlasherError("INTERNAL_TEST_MANIFEST_INVALID","Internal Test manifest ไม่ครบถ้วน",409);
    if(String(manifest.targetChip).toUpperCase()!=="ESP32"||manifest.boardProfile!=="esp32dev-4mb"||manifest.flashSizeBytes!==4194304)throw new FlasherError("FIRMWARE_TARGET_REJECTED","Firmware package ไม่ตรงกับ Lucky Relay Controller",409);
    if(!this.publicKey)throw new FlasherError("SIGNING_KEY_NOT_CONFIGURED","ยังไม่ได้ติดตั้ง verification key",503);
    let signature;try{const encoded=String(this.bytes("manifest.sig").bytes).trim();if(!/^[A-Za-z0-9+/]{86}==$/.test(encoded))throw new Error("encoding");signature=Buffer.from(encoded,"base64");}catch{throw new FlasherError("MANIFEST_SIGNATURE_INVALID","ลายเซ็น Firmware package ไม่ถูกต้อง",409);}
    if(signature.length!==64||!crypto.verify(null,canonicalManifest(manifest),this.publicKey,signature))throw new FlasherError("MANIFEST_SIGNATURE_INVALID","ลายเซ็น Firmware package ไม่ถูกต้อง",409);
    const update=manifest.existingUpdate.files||[],install=manifest.newInstall.files||[],releaseEntries=[...update,...install.filter(x=>x.role!=="sessionNvs"),manifest.esptool,manifest.nvsGenerator,...manifest.distributionAssets];
    const names=new Map();for(const entry of releaseEntries){const prior=names.get(entry.file);if(prior&&prior.sha256!==entry.sha256)throw new FlasherError("MANIFEST_DUPLICATE_FILE","Manifest มีไฟล์ซ้ำที่ไม่ตรงกัน",500);names.set(entry.file,entry);entry.path=this.verifyHash(entry);}for(const list of [update,install]){const offsets=new Set(),files=new Set();for(const entry of list){const offset=normalizeOffset(entry.offset);if(offsets.has(offset))throw new FlasherError("MANIFEST_DUPLICATE_OFFSET","Manifest มี offset ซ้ำ",500);offsets.add(offset);if(entry.file&&(files.has(entry.file)))throw new FlasherError("MANIFEST_DUPLICATE_FILE","Manifest มีไฟล์ซ้ำ",500);if(entry.file)files.add(entry.file);}}
    if(update.length!==1||update[0].role!=="application"||normalizeOffset(update[0].offset)!=="0x10000")throw new FlasherError("UPDATE_LAYOUT_INVALID","Existing Update ต้องมี application ที่ 0x10000 เท่านั้น",500);
    const layout=Object.fromEntries(install.map(x=>[x.role,normalizeOffset(x.offset)]));if(layout.bootloader!=="0x1000"||layout.partitions!=="0x8000"||layout.sessionNvs!=="0x9000"||layout.application!=="0x10000")throw new FlasherError("NEW_INSTALL_LAYOUT_INVALID","New Install layout ไม่ถูกต้อง",500);
    const policy=manifest.nvsPolicy;if(policy.namespace!=="lucky-relay"||policy.offset!=="0x9000"||policy.size!=="0x5000"||JSON.stringify(policy.relayCounts)!=="[2,4,8]")throw new FlasherError("NVS_POLICY_INVALID","NVS policy ไม่ตรงกับ Firmware",500);
    const allowed=new Set(["manifest.json","manifest.sig","THIRD-PARTY-NOTICES.txt","verification-report.json",...names.keys()]);const walk=directory=>{for(const item of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,item.name),relative=path.relative(this.packageRoot,full).replaceAll("\\","/");if(item.isSymbolicLink())throw new FlasherError("PACKAGE_PATH_INVALID","Package ห้ามมี symbolic link",500);if(item.isDirectory()){if(relative!=="LICENSES")throw new FlasherError("PACKAGE_UNEXPECTED_FILE","Package มี directory ที่ไม่ได้รับอนุญาต",500);walk(full);}else if(!allowed.has(relative)&&!relative.startsWith("LICENSES/"))throw new FlasherError("PACKAGE_UNEXPECTED_FILE",`Package มีไฟล์ที่ไม่ได้รับอนุญาต: ${relative}`,500);}};walk(this.packageRoot);
    return {manifest,root:this.packageRoot,esptool:manifest.esptool.path,nvsGenerator:manifest.nvsGenerator.path,files:Object.fromEntries(install.filter(x=>x.role!=="sessionNvs").map(x=>[x.role,x]))};
  }
  verifyLegacy(manifest){const required=["formatVersion","firmwareVersion","buildId","targetChip","boardProfile","flashSize","flashMode","flashFrequency","releaseChannel","esptool","files","signature"];if(required.some(key=>manifest[key]===undefined)||!Array.isArray(manifest.files))throw new FlasherError("MANIFEST_INVALID","Firmware manifest ไม่ครบถ้วน",500);if(manifest.targetChip!=="esp32"||manifest.boardProfile!=="esp32dev"||manifest.flashSize!=="4MB")throw new FlasherError("FIRMWARE_TARGET_REJECTED","Firmware package ไม่ตรงกับ Lucky Relay Controller",409);if(!this.publicKey)throw new FlasherError("SIGNING_KEY_NOT_CONFIGURED","ยังไม่ได้ติดตั้ง verification key",503);if(!crypto.verify(null,canonicalManifest(manifest),this.publicKey,Buffer.from(manifest.signature,"base64")))throw new FlasherError("MANIFEST_SIGNATURE_INVALID","ลายเซ็น Firmware package ไม่ถูกต้อง",409);for(const entry of [...manifest.files,manifest.esptool])entry.path=this.verifyHash(entry);return {manifest,root:this.packageRoot,esptool:this.contained(manifest.esptool.file),files:Object.fromEntries(manifest.files.map(item=>[item.role,item]))};}
}
module.exports={FirmwarePackageService,FlasherError,canonicalManifest,stableValue};
