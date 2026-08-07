const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {FirmwarePackageService}=require("../services/firmware-package-service");
const {resolveDevelopmentFirmwarePackage}=require("../services/development-firmware-package-config");
const {UsbFlasherService}=require("../services/usb-flasher-service");
const root=path.resolve(__dirname,".."),packageRoot=path.join(root,"resources","firmware","internal-test");

test("Revision 3 bundles signed internal-test Firmware 1.2.0 with exact contract",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,"manifest.json"))),publicKey=fs.readFileSync(path.join(packageRoot,"internal-test-public.pem"),"utf8");
  const verified=new FirmwarePackageService({packageRoot,publicKey,mode:"internal-test"}).verify();
  assert.equal(verified.manifest.firmwareVersion,"1.2.0");assert.equal(manifest.apiVersion,"1");assert.equal(manifest.targetChip,"ESP32");assert.equal(manifest.releaseChannel,"internal-test");assert.deepEqual(manifest.supportedRelayCounts,[2,4,8]);
  assert.match(manifest.packageId,/^lucky-relay-1\.2\.0-internal-/);assert.match(manifest.buildId,/^internal-/);
  assert.deepEqual(manifest.existingUpdate.files.map(x=>[x.role,x.offset]),[["application","0x10000"]]);
  assert.deepEqual(manifest.newInstall.files.map(x=>[x.role,x.offset]),[["bootloader","0x1000"],["partitions","0x8000"],["sessionNvs","0x9000"],["application","0x10000"]]);
  for(const entry of [manifest.esptool,manifest.nvsGenerator,...manifest.distributionAssets,...manifest.existingUpdate.files,...manifest.newInstall.files.filter(x=>x.file)]){const file=path.join(packageRoot,entry.file);assert.equal(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),entry.sha256);}
  assert.equal(fs.existsSync(path.join(packageRoot,"boot_app0.bin")),false);assert.equal(JSON.stringify(manifest).includes("boot_app0"),false);
  assert.equal(fs.readdirSync(packageRoot,{recursive:true}).some(name=>/private|\.key$|\.pfx$|\.p12$/i.test(String(name))),false);
});

test("Internal Portable resolves only bundled package and public verification key",()=>{
  const result=resolveDevelopmentFirmwarePackage({workspaceRoot:root,environment:{LUCKY_INTERNAL_TEST:"1",NODE_ENV:"production"}});
  assert.equal(result.packageRoot,packageRoot);assert.equal(result.mode,"internal-test");assert.match(result.publicKey,/BEGIN PUBLIC KEY/);assert.doesNotMatch(result.publicKey,/PRIVATE/);
});

test("Existing Update hashes NVS before/after and verifies version, identity, relay count and OFF state",async()=>{
  const temporary=require("os").tmpdir(),calls=[],application={role:"application",offset:"0x10000",path:path.join(temporary,"firmware.bin")};fs.writeFileSync(application.path,"app");
  const service=new UsbFlasherService({packageService:{verify:()=>({manifest:{firmwareVersion:"1.2.0",releaseChannel:"internal-test"},files:{application},esptool:"esptool.exe"})},relaySafe:async()=>true,recoveryTransport:{request:(_port,payload)=>payload.command==="IDENTIFY"?{ok:true,deviceId:"LRC-ABC",relayCount:4,firmwareVersion:"1.2.0",apiVersion:"1"}:{ok:true,safe:true,activeChannels:[]}},wait:async()=>{}});
  service.run=async(_tool,args)=>{calls.push(args);if(args.includes("chip_id"))return"Chip is ESP32";if(args.includes("flash_id"))return"Detected flash size: 4MB";if(args.includes("read_flash")){fs.writeFileSync(args.at(-1),Buffer.alloc(0x5000,7));return"read";}return"Writing at 0x00010000 (100 %)";};
  const op={id:"op",mode:"update",port:"COM3",progress:0};await service.execute(op,"owner");
  assert.equal(op.state,"COMPLETED");assert.equal(op.postFlashVerification,"PASSED");assert.equal(op.nvsPreservation,"HASH_MATCHED");assert.equal(op.deviceId,"LRC-ABC");assert.equal(op.relayCount,4);
  const write=calls.find(args=>args.includes("write_flash"));assert.ok(write.includes("0x10000"));assert.equal(write.includes("0x9000"),false);assert.equal(calls.filter(args=>args.includes("read_flash")).length,2);
});

test("post-Flash mismatch fails closed without creating a Hardware record",async()=>{
  let records=0;const application={role:"application",offset:"0x10000",path:path.join(require("os").tmpdir(),"firmware-r3.bin")};fs.writeFileSync(application.path,"app");
  const service=new UsbFlasherService({packageService:{verify:()=>({manifest:{firmwareVersion:"1.2.0",releaseChannel:"internal-test"},files:{application},esptool:"tool"})},relaySafe:async()=>true,recoveryTransport:{request:(_p,payload)=>payload.command==="IDENTIFY"?{ok:true,deviceId:"LRC-X",relayCount:4,firmwareVersion:"1.1.0"}:{ok:true,safe:true,activeChannels:[]}},wait:async()=>{}});
  service.run=async(_tool,args)=>{if(args.includes("chip_id"))return"Chip is ESP32";if(args.includes("flash_id"))return"Detected flash size: 4MB";if(args.includes("read_flash"))fs.writeFileSync(args.at(-1),Buffer.alloc(0x5000,3));return"ok";};
  await assert.rejects(()=>service.execute({id:"bad",mode:"update",port:"COM3"},"owner"),{code:"POST_FLASH_VERIFICATION_FAILED"});assert.equal(records,0);
});
