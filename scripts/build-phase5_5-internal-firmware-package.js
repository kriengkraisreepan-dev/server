const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { FirmwarePackageService, canonicalManifest } = require("../services/firmware-package-service");

const root=path.resolve(__dirname,".."),build=path.join(root,"firmware",".pio","build","esp32dev");
const destination=path.join(root,"resources","firmware","internal-test"),temporary=path.join(root,"resources","firmware",`.internal-${process.pid}-${crypto.randomUUID()}`);
const esptool=path.join(root,".phase51-downloads","esptool-4.11.0","esptool-windows-amd64","esptool.exe"),nvsGenerator=path.join(root,"tools","phase5_1","dist","lucky-nvs-generator.exe");
const sha256=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for(const file of ["bootloader.bin","partitions.bin","firmware.bin"].map(name=>path.join(build,name)).concat(esptool,nvsGenerator))if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw Error(`Required file missing: ${path.relative(root,file)}`);
const firmwareVersion=(fs.readFileSync(path.join(root,"firmware","src","config","DeviceConfig.h"),"utf8").match(/kFirmwareVersion\s*=\s*"([^"]+)"/)||[])[1];
if(firmwareVersion!=="1.2.0")throw Error("Revision 3 requires Firmware 1.2.0");
fs.mkdirSync(temporary,{recursive:true});
const copy=(source,name)=>{const target=path.join(temporary,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);return{file:name.replaceAll("\\","/"),sha256:sha256(target),size:fs.statSync(target).size};};
try{
  const bootloader={role:"bootloader",offset:"0x1000",...copy(path.join(build,"bootloader.bin"),"bootloader.bin")};
  const partitions={role:"partitions",offset:"0x8000",...copy(path.join(build,"partitions.bin"),"partitions.bin")};
  const application={role:"application",offset:"0x10000",...copy(path.join(build,"firmware.bin"),"firmware.bin")};
  const tool={role:"esptool",version:"4.11.0",source:"https://github.com/espressif/esptool/releases/tag/v4.11.0",...copy(esptool,"esptool.exe")};
  const nvs={role:"nvsGenerator",version:"esp-idf-v4.4.7+lucky.1",sourceTag:"v4.4.7",sourceCommit:"38eeba213aa695aabfd6d89aa9f5078dbe5a94c3",source:"https://github.com/espressif/esp-idf/tree/v4.4.7/components/nvs_flash/nvs_partition_generator",pythonRuntime:"3.12.13",packager:"PyInstaller 6.11.1",...copy(nvsGenerator,"lucky-nvs-generator.exe")};
  fs.writeFileSync(path.join(temporary,"THIRD-PARTY-NOTICES.txt"),"INTERNAL TEST ONLY — NOT FOR PRODUCTION\nEspressif esptool 4.11.0: GPL-2.0-or-later\nESP-IDF NVS generator v4.4.7: Apache-2.0\n");
  const noticeFile=path.join(temporary,"THIRD-PARTY-NOTICES.txt"),notices={role:"notices",file:"THIRD-PARTY-NOTICES.txt",sha256:sha256(noticeFile),size:fs.statSync(noticeFile).size};
  const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519"),publicPem=publicKey.export({type:"spki",format:"pem"}),publicFile=path.join(temporary,"internal-test-public.pem");fs.writeFileSync(publicFile,publicPem);
  const publicVerification={role:"publicVerificationKey",file:"internal-test-public.pem",sha256:sha256(publicFile),size:fs.statSync(publicFile).size};
  const buildId=`internal-${application.sha256.slice(0,16)}`,packageId=`lucky-relay-1.2.0-${buildId}`;
  const manifest={manifestFormatVersion:1,packageId,product:"Lucky Relay Controller",firmwareVersion,apiVersion:"1",buildId,releaseChannel:"internal-test",signingEnvironment:"internal-test",targetChip:"ESP32",boardProfile:"esp32dev-4mb",flashSizeBytes:4194304,flashMode:"dio",flashFrequency:"40m",supportedRelayCounts:[2,4,8],esptool:tool,nvsGenerator:nvs,distributionAssets:[notices,publicVerification],nvsPolicy:{schemaVersion:1,namespace:"lucky-relay",offset:"0x9000",size:"0x5000",keys:{apiKey:"string",setupCode:"string",setupVersion:"u8",wifiSSID:"string",wifiPassword:"string",relayCount:"u8"},relayCounts:[2,4,8],secretGeneration:"CSPRNG_DEVICE_KEY_32_BYTES_BASE31_SETUP_CODE_12",cleanup:"DELETE_TEMP_ON_ALL_TERMINAL_PATHS"},existingUpdate:{files:[application]},newInstall:{files:[bootloader,partitions,{role:"sessionNvs",offset:"0x9000",authorization:"IN_MEMORY_SHA256"},application]}};
  fs.writeFileSync(path.join(temporary,"manifest.json"),canonicalManifest(manifest));fs.writeFileSync(path.join(temporary,"manifest.sig"),crypto.sign(null,canonicalManifest(manifest),privateKey).toString("base64"));
  new FirmwarePackageService({packageRoot:temporary,publicKey:publicPem,mode:"internal-test"}).verify();
  fs.rmSync(destination,{recursive:true,force:true});fs.renameSync(temporary,destination);
  process.stdout.write(`${JSON.stringify({packageRoot:destination,packageId,buildId,firmwareVersion,manifestSha256:sha256(path.join(destination,"manifest.json")),privateKeyPackaged:false},null,2)}\n`);
}catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
