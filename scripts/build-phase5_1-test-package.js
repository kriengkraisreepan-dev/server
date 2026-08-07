const crypto=require("crypto");
const fs=require("fs");
const path=require("path");
const {FirmwarePackageService,canonicalManifest}=require("../services/firmware-package-service");

const root=path.resolve(__dirname,".."),runtimeRoot=path.join(root,"runtime","firmware-packages","test"),firmwareBuild=path.join(root,"firmware",".pio","build","esp32dev");
const generator=path.join(root,"tools","phase5_1","dist","lucky-nvs-generator.exe"),esptool=path.join(root,".phase51-downloads","esptool-4.11.0","esptool-windows-amd64","esptool.exe");
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const copy=(source,target)=>{fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);return {file:path.relative(packageTemp,target).replaceAll("\\","/"),sha256:sha(target),size:fs.statSync(target).size};};
const requireFile=file=>{if(!fs.existsSync(file))throw Error(`Required release input missing: ${path.relative(root,file)}`);const resolved=fs.realpathSync(file);if(!resolved.startsWith(`${root}${path.sep}`))throw Error("Release input escaped workspace");};
for(const file of [generator,esptool,...["bootloader.bin","partitions.bin","firmware.bin"].map(name=>path.join(firmwareBuild,name))])requireFile(file);
const appBytes=fs.readFileSync(path.join(firmwareBuild,"firmware.bin"));for(const forbidden of ["TinTin_2.4G","0979269904","lucky-relay-1234"])if(appBytes.includes(Buffer.from(forbidden)))throw Error("BOOTSTRAP_SECRET_PRESENT");
const firmwareVersion=(fs.readFileSync(path.join(root,"firmware","src","config","DeviceConfig.h"),"utf8").match(/kFirmwareVersion\s*=\s*"([^"]+)"/)||[])[1];if(!firmwareVersion)throw Error("Firmware version not found");
const appHash=sha(path.join(firmwareBuild,"firmware.bin")),buildId=`test-${appHash.slice(0,16)}`,finalDir=path.join(runtimeRoot,firmwareVersion),packageTemp=path.join(runtimeRoot,`.tmp-${process.pid}-${crypto.randomUUID()}`);
fs.mkdirSync(packageTemp,{recursive:true});
try{
  const boot={role:"bootloader",offset:"0x1000",...copy(path.join(firmwareBuild,"bootloader.bin"),path.join(packageTemp,"bootloader.bin"))};
  const partitions={role:"partitions",offset:"0x8000",...copy(path.join(firmwareBuild,"partitions.bin"),path.join(packageTemp,"partitions.bin"))};
  const application={role:"application",offset:"0x10000",...copy(path.join(firmwareBuild,"firmware.bin"),path.join(packageTemp,"firmware.bin"))};
  const tool={version:"4.11.0",source:"https://github.com/espressif/esptool/releases/tag/v4.11.0",...copy(esptool,path.join(packageTemp,"esptool.exe"))};
  const nvsTool={version:"esp-idf-v4.4.7+lucky.1",sourceTag:"v4.4.7",sourceCommit:"38eeba213aa695aabfd6d89aa9f5078dbe5a94c3",source:"https://github.com/espressif/esp-idf/tree/v4.4.7/components/nvs_flash/nvs_partition_generator",pythonRuntime:"3.12.13",packager:"PyInstaller 6.11.1",...copy(generator,path.join(packageTemp,"lucky-nvs-generator.exe"))};
  const notices=`TEST DISTRIBUTION — ENGINEERING INVENTORY, NOT LEGAL ADVICE\n\nEspressif ESP-IDF NVS generator v4.4.7 — Apache-2.0\nSource: https://github.com/espressif/esp-idf/tree/v4.4.7/components/nvs_flash/nvs_partition_generator\nLucky-built with Python 3.12.13 and PyInstaller 6.11.1; not an official Espressif binary.\n\nesptool 4.11.0 — GPL-2.0-or-later\nSource/corresponding source: https://github.com/espressif/esptool/tree/v4.11.0\n\nPython 3.12.13 — Python Software Foundation License\nSource: https://github.com/python/cpython/tree/v3.12.13\n\nPyInstaller 6.11.1 — GPL-2.0-or-later with bootloader exception\nSource: https://github.com/pyinstaller/pyinstaller/tree/v6.11.1\n\ncryptography 49.0.0 and bundled OpenSSL — Apache-2.0 OR BSD-3-Clause; see upstream notices.\nSource: https://github.com/pyca/cryptography/tree/49.0.0\n\nDistribution review is mandatory before production release.\n`;
  fs.writeFileSync(path.join(packageTemp,"THIRD-PARTY-NOTICES.txt"),notices);
  const noticesPath=path.join(packageTemp,"THIRD-PARTY-NOTICES.txt"),distributionAssets=[{role:"notices",file:"THIRD-PARTY-NOTICES.txt",sha256:sha(noticesPath),size:fs.statSync(noticesPath).size}];
  const licenseDirectory=path.join(root,"tools","phase5_1","licenses");for(const name of fs.readdirSync(licenseDirectory).sort()){const source=path.join(licenseDirectory,name);requireFile(source);distributionAssets.push({role:"license",...copy(source,path.join(packageTemp,"LICENSES",name))});}
  const manifest={manifestFormatVersion:1,product:"Lucky Relay Controller",firmwareVersion,buildId,releaseChannel:"test",signingEnvironment:"test",targetChip:"ESP32",boardProfile:"esp32dev-4mb",flashSizeBytes:4194304,flashMode:"dio",flashFrequency:"40m",esptool:tool,nvsGenerator:nvsTool,distributionAssets,nvsPolicy:{schemaVersion:1,namespace:"lucky-relay",offset:"0x9000",size:"0x5000",keys:{apiKey:"string",setupCode:"string",setupVersion:"u8",wifiSSID:"string",wifiPassword:"string",relayCount:"u8"},relayCounts:[2,4,8],secretGeneration:"CSPRNG_DEVICE_KEY_32_BYTES_BASE31_SETUP_CODE_12",cleanup:"DELETE_TEMP_ON_ALL_TERMINAL_PATHS"},existingUpdate:{files:[application]},newInstall:{files:[boot,partitions,{role:"sessionNvs",offset:"0x9000",authorization:"IN_MEMORY_SHA256"},application]}};
  fs.writeFileSync(path.join(packageTemp,"manifest.json"),canonicalManifest(manifest));
  const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519"),signature=crypto.sign(null,canonicalManifest(manifest),privateKey);fs.writeFileSync(path.join(packageTemp,"manifest.sig"),signature.toString("base64"));
  const keyDir=path.join(runtimeRoot,".test-keys");fs.mkdirSync(keyDir,{recursive:true});const publicPem=publicKey.export({type:"spki",format:"pem"});fs.writeFileSync(path.join(keyDir,`${buildId}.public.pem`),publicPem,{mode:0o600});
  new FirmwarePackageService({packageRoot:packageTemp,publicKey:publicPem,mode:"test"}).verify();
  fs.rmSync(finalDir,{recursive:true,force:true});fs.mkdirSync(path.dirname(finalDir),{recursive:true});fs.renameSync(packageTemp,finalDir);
  fs.writeFileSync(path.join(finalDir,"verification-report.json"),JSON.stringify({verified:true,firmwareVersion,buildId,manifestSha256:sha(path.join(finalDir,"manifest.json")),signatureSha256:sha(path.join(finalDir,"manifest.sig")),generatedAt:new Date().toISOString(),hardwareFlashPerformed:false},null,2));
  console.log(JSON.stringify({package:finalDir,publicKey:path.join(keyDir,`${buildId}.public.pem`),firmwareVersion,buildId,verified:true},null,2));
}catch(error){fs.rmSync(packageTemp,{recursive:true,force:true});throw error;}
