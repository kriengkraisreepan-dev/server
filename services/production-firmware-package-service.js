const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { FlasherError, canonicalManifest } = require("./firmware-package-service");
const { FirmwareProductionTrustStore } = require("./firmware-production-trust-store");

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MANIFEST_KEYS = Object.freeze(["apiVersion","boardProfile","buildId","createdAt","distributionAssets","esptool","existingUpdate","files","firmwareVersion","flashFrequency","flashMode","flashSizeBytes","hardwareStandard","manifestFormatVersion","minimumManagerVersion","newInstall","nvsGenerator","nvsPolicy","partitionLayoutVersion","product","releaseChannel","signingEnvironment","signingKeyId","sourceCommit","targetChip","toolchain"]);
const ROOT_FILES = new Set(["manifest.json","manifest.sig","bootloader.bin","partitions.bin","firmware.bin","esptool.exe","lucky-nvs-generator.exe","PROVENANCE.json","RELEASE_NOTES.md","THIRD-PARTY-NOTICES.txt"]);
const REQUIRED_PACKAGE_FILES = Object.freeze([...ROOT_FILES, "LICENSES"]);
const REQUIRED_ASSETS = Object.freeze({ bootloader:"bootloader.bin", partitions:"partitions.bin", application:"firmware.bin", esptool:"esptool.exe", nvsGenerator:"lucky-nvs-generator.exe", provenance:"PROVENANCE.json", releaseNotes:"RELEASE_NOTES.md", notices:"THIRD-PARTY-NOTICES.txt" });

function exactKeys(value, keys, code = "MANIFEST_SCHEMA_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) throw new FlasherError(code, "Manifest schema ไม่ตรงกับ contract", 409);
}
function compareSemver(left, right) { const a=String(left).match(SEMVER_RE),b=String(right).match(SEMVER_RE);if(!a||!b)throw new FlasherError("VERSION_INVALID","Firmware version ต้องเป็น MAJOR.MINOR.PATCH",409);for(let i=1;i<=3;i+=1){const delta=Number(a[i])-Number(b[i]);if(delta)return Math.sign(delta);}return 0; }
function safeRelative(value) { const text=String(value||"").replaceAll("\\","/");if(!text||path.posix.isAbsolute(text)||text.split("/").some(part=>!part||part==="."||part===".."))throw new FlasherError("PACKAGE_PATH_INVALID","Package path ไม่ถูกต้อง",409);return text; }

class ProductionFirmwarePackageService {
  constructor({ packageRoot, trustStore = new FirmwareProductionTrustStore(), mode = "production", managerVersion = "1.0.0", currentFirmware, audit = () => {} } = {}) {
    this.packageRoot=path.resolve(packageRoot||"");this.trustStore=trustStore;this.mode=mode;this.managerVersion=managerVersion;this.currentFirmware=currentFirmware;this.audit=audit;
  }
  file(relative) { const safe=safeRelative(relative),resolved=path.resolve(this.packageRoot,safe);if(!resolved.startsWith(`${this.packageRoot}${path.sep}`))throw new FlasherError("PACKAGE_PATH_INVALID","Package path ออกจาก release directory",409);let stat;try{stat=fs.lstatSync(resolved);}catch{throw new FlasherError("PACKAGE_FILE_MISSING",`ไม่พบ ${safe}`,409);}if(stat.isSymbolicLink()||!stat.isFile())throw new FlasherError("PACKAGE_PATH_INVALID",`${safe} ต้องเป็น regular file`,409);return resolved; }
  readJson(name) { try{return JSON.parse(fs.readFileSync(this.file(name),"utf8"));}catch(error){if(error instanceof FlasherError)throw error;throw new FlasherError("MANIFEST_INVALID",`${name} ไม่ใช่ JSON ที่ถูกต้อง`,409);} }
  scanPackage() {
    const seen=new Set();
    for(const entry of fs.readdirSync(this.packageRoot,{withFileTypes:true})){
      if(entry.isSymbolicLink())throw new FlasherError("PACKAGE_PATH_INVALID","Package ห้ามมี symlink",409);
      if(entry.isDirectory()){
        if(entry.name!=="LICENSES")throw new FlasherError("PACKAGE_UNEXPECTED_FILE",`Directory ${entry.name} ไม่อยู่ใน allowlist`,409);
        for(const license of fs.readdirSync(path.join(this.packageRoot,"LICENSES"),{withFileTypes:true})){
          if(!license.isFile()||license.isSymbolicLink()||/\.(?:exe|dll|com|bat|cmd|ps1|js|mjs|cjs|py|scr)$/i.test(license.name))throw new FlasherError("PACKAGE_UNEXPECTED_FILE","LICENSES อนุญาตเฉพาะ regular non-executable files",409);
          const key=`licenses/${license.name.toLowerCase()}`;if(seen.has(key))throw new FlasherError("PACKAGE_DUPLICATE_PATH","Package มี path ซ้ำ",409);seen.add(key);
        }
      }else if(!entry.isFile()||!ROOT_FILES.has(entry.name))throw new FlasherError("PACKAGE_UNEXPECTED_FILE",`ไฟล์ ${entry.name} ไม่อยู่ใน allowlist`,409);
      const key=entry.name.toLowerCase();if(seen.has(key))throw new FlasherError("PACKAGE_DUPLICATE_PATH","Package มี path ซ้ำ",409);seen.add(key);
    }
    for(const required of REQUIRED_PACKAGE_FILES)if(!fs.existsSync(path.join(this.packageRoot,required)))throw new FlasherError("PACKAGE_FILE_MISSING",`Package ขาด ${required}`,409);
  }
  validateManifest(manifest) {
    exactKeys(manifest,MANIFEST_KEYS);
    if(manifest.manifestFormatVersion!==2||manifest.product!=="Lucky Relay Controller"||manifest.releaseChannel!=="production")throw new FlasherError("MANIFEST_SCHEMA_INVALID","Manifest ไม่ใช่ Production v2",409);
    const allowedEnvironment=this.mode==="production"?"production":"production-like-test";if(manifest.signingEnvironment!==allowedEnvironment)throw new FlasherError("SIGNING_ENVIRONMENT_REJECTED","Signing environment ไม่ตรงกับ verifier mode",409);
    if(!SEMVER_RE.test(manifest.firmwareVersion)||!SEMVER_RE.test(manifest.minimumManagerVersion))throw new FlasherError("VERSION_INVALID","Version ต้องเป็น Semantic Versioning",409);
    if(compareSemver(this.managerVersion,manifest.minimumManagerVersion)<0)throw new FlasherError("MANAGER_VERSION_TOO_OLD","Manager version ต่ำกว่าที่ firmware กำหนด",409);
    if(manifest.apiVersion!=="1"||manifest.hardwareStandard!=="LHS-1.0"||manifest.targetChip!=="ESP32"||manifest.boardProfile!=="esp32dev-4mb"||manifest.flashSizeBytes!==4194304||manifest.partitionLayoutVersion!==1||manifest.flashMode!=="dio"||manifest.flashFrequency!=="40m")throw new FlasherError("FIRMWARE_TARGET_REJECTED","Target หรือ hardware contract ไม่ถูกต้อง",409);
    if(!/^[a-f0-9]{40}$/i.test(manifest.sourceCommit)||!/^prod-[a-f0-9]{16,64}$/i.test(manifest.buildId)||!Number.isFinite(Date.parse(manifest.createdAt)))throw new FlasherError("MANIFEST_SCHEMA_INVALID","Build provenance fields ไม่ถูกต้อง",409);
    exactKeys(manifest.toolchain,["arduinoEsp32Core","compiler","platformioEspressif32"]);if(manifest.toolchain.platformioEspressif32!=="6.9.0"||manifest.toolchain.arduinoEsp32Core!=="3.20017.241212")throw new FlasherError("TOOL_PROVENANCE_REJECTED","Toolchain version ไม่ได้รับอนุมัติ",409);
    exactKeys(manifest.esptool,["path","role","sha256","size","source","version"]);exactKeys(manifest.nvsGenerator,["path","role","sha256","size","sourceCommit","sourceTag","version"]);
    if(manifest.esptool.path!==REQUIRED_ASSETS.esptool||manifest.esptool.role!=="esptool"||manifest.esptool.version!=="4.11.0"||manifest.nvsGenerator.path!==REQUIRED_ASSETS.nvsGenerator||manifest.nvsGenerator.role!=="nvsGenerator"||manifest.nvsGenerator.version!=="esp-idf-v4.4.7+lucky.1")throw new FlasherError("TOOL_PROVENANCE_REJECTED","Release tool ไม่ตรง approved provenance",409);
    exactKeys(manifest.nvsPolicy,["cleanup","namespace","offset","relayCounts","schemaVersion","secretGeneration","size"]);if(manifest.nvsPolicy.namespace!=="lucky-relay"||manifest.nvsPolicy.offset!=="0x9000"||manifest.nvsPolicy.size!=="0x5000"||JSON.stringify(manifest.nvsPolicy.relayCounts)!=="[2,4,8]")throw new FlasherError("NVS_POLICY_INVALID","NVS policy ไม่ถูกต้อง",409);
    if(!Array.isArray(manifest.files)||!Array.isArray(manifest.distributionAssets))throw new FlasherError("MANIFEST_SCHEMA_INVALID","files ต้องเป็น array",409);
  }
  verifyFiles(manifest) {
    const paths=new Set(),roles=new Map();
    for(const item of manifest.files){exactKeys(item,["path","role","sha256","size"]);const relative=safeRelative(item.path),key=relative.toLowerCase();if(paths.has(key))throw new FlasherError("MANIFEST_DUPLICATE_FILE","Manifest มี path ซ้ำ",409);paths.add(key);if(roles.has(item.role))throw new FlasherError("MANIFEST_DUPLICATE_ROLE","Manifest มี role ซ้ำ",409);roles.set(item.role,item);if(!/^[a-f0-9]{64}$/.test(item.sha256)||!Number.isInteger(item.size)||item.size<1)throw new FlasherError("MANIFEST_SCHEMA_INVALID","File digest/size ไม่ถูกต้อง",409);const full=this.file(relative),bytes=fs.readFileSync(full),actual=crypto.createHash("sha256").update(bytes).digest("hex");if(bytes.length!==item.size||actual!==item.sha256)throw new FlasherError("PACKAGE_HASH_MISMATCH",`${relative} ไม่ผ่าน SHA-256`,409);}
    for(const [role,expectedPath] of Object.entries(REQUIRED_ASSETS)){const item=roles.get(role);if(!item||item.path!==expectedPath)throw new FlasherError("PACKAGE_FILE_MISSING",`Package ขาด role ${role}`,409);}
    if(manifest.esptool.sha256!==roles.get("esptool").sha256||manifest.esptool.size!==roles.get("esptool").size||manifest.nvsGenerator.sha256!==roles.get("nvsGenerator").sha256||manifest.nvsGenerator.size!==roles.get("nvsGenerator").size)throw new FlasherError("TOOL_PROVENANCE_REJECTED","Tool metadata ไม่ตรง file inventory",409);
    if(manifest.buildId!==`prod-${roles.get("application").sha256.slice(0,16)}`)throw new FlasherError("BUILD_ID_INVALID","Build ID ไม่ตรง application hash",409);
    const licenses=manifest.files.filter(item=>item.role.startsWith("license:"));if(!licenses.length||licenses.some(item=>!item.path.startsWith("LICENSES/")))throw new FlasherError("DISTRIBUTION_ASSET_INVALID","License inventory ไม่ครบ",409);
    const expectedDistribution=manifest.files.filter(item=>["provenance","releaseNotes","notices"].includes(item.role)||item.role.startsWith("license:")).map(item=>item.path).sort();if([...manifest.distributionAssets].sort().join("|")!==expectedDistribution.join("|"))throw new FlasherError("DISTRIBUTION_ASSET_INVALID","Distribution asset inventory ไม่ตรง files",409);
    const provenance=this.readJson("PROVENANCE.json");if(provenance.buildClassification!=="provenance-recorded build"||provenance.sourceCommit!==manifest.sourceCommit||provenance.firmwareBuildId!==manifest.buildId||provenance.firmwareSha256!==roles.get("application").sha256||provenance.signingKeyId!==manifest.signingKeyId||provenance.manifestFormatVersion!==2)throw new FlasherError("PROVENANCE_INVALID","Provenance ไม่ตรง manifest",409);
    const expectedDisk=new Set(["manifest.json","manifest.sig",...manifest.files.map(item=>item.path)]);const actual=[];for(const entry of fs.readdirSync(this.packageRoot,{withFileTypes:true})){if(entry.name==="LICENSES")for(const license of fs.readdirSync(path.join(this.packageRoot,"LICENSES")))actual.push(`LICENSES/${license}`);else actual.push(entry.name);}if(actual.some(item=>!expectedDisk.has(item))||expectedDisk.size!==actual.length)throw new FlasherError("PACKAGE_UNEXPECTED_FILE","Package content ไม่ตรง manifest",409);
    const offsets=new Set();
    exactKeys(manifest.existingUpdate,["files"]);exactKeys(manifest.newInstall,["files"]);
    if(manifest.existingUpdate.files.length!==1||manifest.existingUpdate.files[0].role!=="application"||manifest.existingUpdate.files[0].offset!=="0x10000")throw new FlasherError("UPDATE_LAYOUT_INVALID","Existing Update ต้องเขียน application ที่ 0x10000 เท่านั้น",409);
    for(const item of manifest.newInstall.files){exactKeys(item,item.role==="sessionNvs"?["authorization","offset","role"]:["offset","role"]);if(offsets.has(item.offset))throw new FlasherError("MANIFEST_DUPLICATE_OFFSET","New Install มี offset ซ้ำ",409);offsets.add(item.offset);}
    const layout=Object.fromEntries(manifest.newInstall.files.map(item=>[item.role,item.offset]));if(layout.bootloader!=="0x1000"||layout.partitions!=="0x8000"||layout.sessionNvs!=="0x9000"||layout.application!=="0x10000")throw new FlasherError("NEW_INSTALL_LAYOUT_INVALID","Partition layout ไม่ถูกต้อง",409);
    return roles;
  }
  enforceVersion(manifest, roles) { if(!this.currentFirmware)return;const cmp=compareSemver(manifest.firmwareVersion,this.currentFirmware.version);if(cmp<0)throw new FlasherError("FIRMWARE_DOWNGRADE_REJECTED","ไม่อนุญาต firmware downgrade",409);if(cmp===0&&(manifest.buildId!==this.currentFirmware.buildId||roles.get("application").sha256!==this.currentFirmware.applicationSha256))throw new FlasherError("SAME_VERSION_RELEASE_MISMATCH","Same version ต้องใช้ build ID และ hash เดิม",409); }
  verify() {
    try{this.scanPackage();const manifest=this.readJson("manifest.json");this.validateManifest(manifest);const key=this.trustStore.resolve(manifest.signingKeyId,manifest.createdAt),signatureText=fs.readFileSync(this.file("manifest.sig"),"utf8").trim();if(!/^[A-Za-z0-9+/]{86}==$/.test(signatureText))throw new FlasherError("MANIFEST_SIGNATURE_INVALID","Detached signature encoding ไม่ถูกต้อง",409);const signature=Buffer.from(signatureText,"base64");if(signature.length!==64||!crypto.verify(null,canonicalManifest(manifest),key.publicKeyPem,signature))throw new FlasherError("MANIFEST_SIGNATURE_INVALID","Production signature ไม่ถูกต้อง",409);const roles=this.verifyFiles(manifest);this.enforceVersion(manifest,roles);this.audit("PRODUCTION_PACKAGE_VERIFICATION_SUCCEEDED",{buildId:manifest.buildId,firmwareVersion:manifest.firmwareVersion,signingKeyId:manifest.signingKeyId});const offsets={bootloader:"0x1000",partitions:"0x8000",application:"0x10000"},files={};for(const role of ["bootloader","partitions","application"]){const item=roles.get(role);files[role]={...item,file:item.path,path:this.file(item.path),offset:offsets[role]};}return {manifest,root:this.packageRoot,roles,files,esptool:this.file(roles.get("esptool").path),nvsGenerator:this.file(roles.get("nvsGenerator").path),signingKey:{keyId:key.keyId,fingerprintSha256:key.fingerprintSha256}};}catch(error){this.audit("PRODUCTION_PACKAGE_VERIFICATION_FAILED",{errorCategory:error.code||"VERIFICATION_FAILED"});throw error;}
  }
}
module.exports={ProductionFirmwarePackageService,MANIFEST_KEYS,ROOT_FILES,REQUIRED_ASSETS,SEMVER_RE,compareSemver,safeRelative};
