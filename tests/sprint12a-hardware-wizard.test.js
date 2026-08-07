const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {HardwareSetupWizardService}=require("../services/hardware-setup-wizard-service");
const {HardwareRepository}=require("../repositories/hardware-repository");
const {HardwareService}=require("../services/hardware-service");

function validProbe(overrides={}){
  const count=overrides.count||2,id=overrides.id||"LRC-100";
  return {
    health:{success:true,deviceId:id,deviceName:"Lucky Relay",firmwareVersion:"1.0.0",relayCount:count,wifiConnected:true,rssi:-45,uptimeSeconds:20,freeHeapBytes:80000,...overrides.health},
    identity:{success:true,deviceId:id,deviceName:"Lucky Relay",firmwareVersion:"1.0.0",apiVersion:"1",hardwareStandard:"LHS-1.0",boardModel:"ESP32",relayCount:count,...overrides.identity},
    config:{success:true,relayCount:count,supportedRelayCounts:[2,4,8],activeChannels:Array.from({length:count},(_,i)=>i+1),...overrides.config},
    relays:{success:true,relayCount:count,relays:Array.from({length:count},(_,i)=>({channel:i+1,state:"OFF",gpio:13+i})),...overrides.relays}
  };
}
function fixture(options={}){
  const calls=[],logs=[],saved=[];
  let states=validProbe(),enabled=options.enabled!==false;
  const driver={
    endpoint:d=>{if(!/^192\.168\.\d+\.\d+$/.test(d.ipAddress)){const e=Error("invalid");e.code="INVALID_IP";throw e;}return `http://${d.ipAddress}`;},
    probe:async()=>{if(options.probeError)throw options.probeError;return states;},
    verifyDevice:async d=>{calls.push({op:"verifyDevice",key:d.apiKey});if(options.verifyError)throw options.verifyError;return {success:true,verified:true,deviceId:states.identity.deviceId};},
    allOff:async d=>{calls.push({op:"allOff",key:d.apiKey});if(options.allOffError)throw options.allOffError;return {success:true,state:"OFF"};},
    setRelayState:async(d,ch,on)=>{calls.push({op:on?"on":"off",ch,key:d.apiKey});if(options.failOn&&on)throw Error("on failed");if(options.failOff&&!on)throw Error("off failed");return {success:true};},
    relays:async()=>{calls.push({op:"read"});return options.badFinalState?{relays:[{channel:1,state:"ON"}]}:states.relays;}
  };
  const hardwareService={saveVerifiedSetup:(candidate,verification,metadata)=>{saved.push({candidate,verification,metadata});return {device:{id:"hw-1",deviceName:metadata.deviceName,firmwareVersion:verification.firmwareVersion,relayCount:verification.relayCount,relayTestStatus:metadata.relayTestStatus},updated:Boolean(options.updated)};}};
  const service=new HardwareSetupWizardService({driver,hardwareService,enabled:()=>enabled,log:(level,event,details)=>logs.push({level,event,details}),wait:options.wait||(()=>Promise.resolve())});
  return {service,driver,calls,logs,saved,setProbe:value=>states=value,setEnabled:value=>enabled=value};
}
async function verified(x){
  const draft=x.service.start("owner");
  return x.service.verify(draft.id,{host:"192.168.1.191"});
}

test("wizard welcome, verification, back-compatible completion and no secret response",async()=>{
  const x=fixture(),v=await verified(x);
  assert.equal(v.step,"AUTHENTICATION");assert.equal(v.apiKey,undefined);
  const a=await x.service.authenticate(v.id,{apiKey:"secret",confirmedAllOff:true});
  assert.equal(a.hasApiKey,true);assert.equal(JSON.stringify(a).includes("secret"),false);
  await x.service.testRelay(v.id,{channel:1});
  await x.service.testRelay(v.id,{channel:2});
  const named=x.service.naming(v.id);assert.equal(named.step,"NAMING");
  const result=x.service.save(v.id,{deviceName:"โซนหลัก",locationLabel:"ชั้น 1"},"owner");
  assert.equal(result.device.deviceName,"โซนหลัก");assert.equal(x.saved[0].candidate.apiKey,"secret");
  assert.throws(()=>x.service.get(v.id),{code:"OPERATION_CANCELLED"});
});

test("feature flag disabled prevents wizard while old hardware service stays independent",()=>{
  const x=fixture({enabled:false});
  assert.throws(()=>x.service.start("owner"));
  assert.equal(typeof x.service.hardwareService.saveVerifiedSetup,"function");
});

test("verification rejects timeout, malformed response, mismatches, wrong identity and Wi-Fi",async()=>{
  const timeout=Error("timeout");timeout.code="DEVICE_TIMEOUT";
  await assert.rejects(()=>verified(fixture({probeError:timeout})),{code:"DEVICE_TIMEOUT"});
  for(const mutate of [
    p=>{p.health.success=false;},
    p=>{p.config.relayCount=4;},
    p=>{p.health.deviceId="OTHER";},
    p=>{p.health.wifiConnected=false;},
    p=>{p.relays.relays=[];}
  ]){
    const x=fixture(),p=validProbe();mutate(p);x.setProbe(p);
    await assert.rejects(()=>verified(x));
  }
});

test("unknown newer firmware is a warning, not a critical failure",async()=>{
  const x=fixture(),p=validProbe();p.identity.firmwareVersion="2.0.0";x.setProbe(p);
  const draft=await verified(x);assert.equal(draft.verification.warning,"UNKNOWN_NEWER_FIRMWARE");
});

test("authentication uses device verify without changing Relay, requires confirmation, and never logs key",async()=>{
  const x=fixture(),draft=await verified(x);
  await assert.rejects(()=>x.service.authenticate(draft.id,{apiKey:"secret",confirmedAllOff:false}),{code:"AUTHENTICATION_FAILED"});
  x.driver.verifyDevice=async()=>{const e=Error("401");e.code="DEVICE_AUTH_FAILED";e.status=401;throw e;};
  await assert.rejects(()=>x.service.authenticate(draft.id,{apiKey:"top-secret",confirmedAllOff:true}),{code:"AUTHENTICATION_FAILED"});
  assert.equal(JSON.stringify(x.logs).includes("top-secret"),false);
});

test("successful authentication calls verify endpoint only and leaves Relay untouched",async()=>{
  const x=fixture(),draft=await verified(x);
  await x.service.authenticate(draft.id,{apiKey:"secret",confirmedDeviceAccess:true});
  assert.deepEqual(x.calls.map(call=>call.op),["verifyDevice"]);
});

test("relay pulse performs all-off, ON, OFF, read and final all-off",async()=>{
  const x=fixture(),draft=await verified(x);await x.service.authenticate(draft.id,{apiKey:"secret",confirmedAllOff:true});x.calls.length=0;
  await x.service.testRelay(draft.id,{channel:1,durationMs:5000});
  assert.deepEqual(x.calls.map(x=>x.op),["allOff","on","off","read","off","allOff"]);
  assert.ok(x.calls.every(call=>call.key==="secret"||call.op==="read"));
  assert.equal(JSON.stringify(x.logs).includes("secret"),false);
});

test("relay failure still attempts OFF and final all-off",async()=>{
  const x=fixture({failOn:true}),draft=await verified(x);await x.service.authenticate(draft.id,{apiKey:"secret",confirmedAllOff:true});x.calls.length=0;
  await assert.rejects(()=>x.service.testRelay(draft.id,{channel:1}),{code:"RELAY_TEST_FAILED"});
  assert.deepEqual(x.calls.map(x=>x.op),["allOff","on","off","allOff"]);
});

test("cancellation and emergency action force all-off and clear draft secret",async()=>{
  const x=fixture(),draft=await verified(x);await x.service.authenticate(draft.id,{apiKey:"secret",confirmedAllOff:true});x.calls.length=0;
  await x.service.emergencyOff(draft.id);await x.service.cancel(draft.id);
  assert.deepEqual(x.calls.map(x=>x.op),["allOff","allOff"]);
  assert.throws(()=>x.service.get(draft.id),{code:"OPERATION_CANCELLED"});
});

test("skipped channels persist warning status",async()=>{
  const x=fixture(),draft=await verified(x);await x.service.authenticate(draft.id,{apiKey:"secret",confirmedAllOff:true});
  await x.service.testRelay(draft.id,{channel:1});x.service.skip(draft.id,[2]);
  x.service.save(draft.id,{deviceName:"กล่องเตือน"},"owner");
  assert.equal(x.saved[0].metadata.relayTestStatus,"PARTIAL");
  assert.equal(x.saved[0].metadata.verificationStatus,"WARNING");
});

test("duplicate simultaneous relay test is rejected",async()=>{
  let release;const wait=()=>new Promise(resolve=>{release=resolve;});
  const x=fixture({wait}),draft=await verified(x);await x.service.authenticate(draft.id,{apiKey:"secret",confirmedAllOff:true});
  const running=x.service.testRelay(draft.id,{channel:1});
  await Promise.resolve();await assert.rejects(()=>x.service.testRelay(draft.id,{channel:2}),{status:409});
  release();await running;
});

test("saving an existing device by deviceId preserves record id and table mapping",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lucky-wizard-save-"));
  try{
    const repository=new HardwareRepository(path.join(dir,"hardware-devices.json"));
    const existing=repository.create({deviceName:"เดิม",deviceId:"LRC-100",ipAddress:"192.168.1.10",port:80,apiKey:"old",relayCount:2,status:"ONLINE"});
    const tables=[{id:1,hardwareDeviceId:existing.id,relayChannel:1}];
    const service=new HardwareService(repository,{endpoint:()=>""},{tables:()=>tables,saveTables:()=>{},audit:()=>{}});
    const result=service.saveVerifiedSetup({ipAddress:"192.168.1.191",port:80,apiKey:"new",deviceType:"RELAY_CONTROLLER"},{deviceId:"LRC-100",relayCount:2,firmwareVersion:"1.1.0",apiVersion:"1",hardwareStandard:"LHS-1.0"},{deviceName:"ชื่อใหม่",verificationStatus:"PASSED",relayTestStatus:"PASSED",relayTestedChannels:[1,2]},"owner");
    assert.equal(result.updated,true);assert.equal(result.device.id,existing.id);
    assert.deepEqual(tables[0],{id:1,hardwareDeviceId:existing.id,relayChannel:1});
    assert.equal(repository.list().length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("legacy Device ID migration requires user confirmation and verified Device Key before preserving mapping",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lucky-wizard-legacy-"));
  try{
    const repository=new HardwareRepository(path.join(dir,"hardware-devices.json"));
    const existing=repository.create({deviceName:"Legacy",deviceId:"LRC-0001",ipAddress:"192.168.1.191",port:80,apiKey:"old-key",relayCount:2,status:"ONLINE"});
    const tables=[{id:1,hardwareDeviceId:existing.id,relayChannel:1}];
    const hardwareService=new HardwareService(repository,{endpoint:()=>""},{tables:()=>tables,saveTables:()=>{},audit:()=>{}});
    const states=validProbe({id:"LRC-AABBCCDDEEFF"});
    states.identity.previousDeviceId="LRC-0001";states.identity.identityMigrationVersion=1;
    states.health.previousDeviceId="LRC-0001";states.health.identityMigrationVersion=1;
    const driver={
      endpoint:()=>"",
      probe:async()=>states,
      verifyDevice:async device=>({success:true,verified:true,deviceId:"LRC-AABBCCDDEEFF",previousDeviceId:"LRC-0001",identityMigrationVersion:1,keyUsed:device.apiKey})
    };
    const wizard=new HardwareSetupWizardService({driver,hardwareService,wait:()=>Promise.resolve()});
    const started=wizard.start("owner");
    const verifiedDraft=await wizard.verify(started.id,{host:"192.168.1.191"});
    assert.equal(verifiedDraft.legacyMigration.id,existing.id);
    await assert.rejects(()=>wizard.authenticate(started.id,{apiKey:"new-unique-key",confirmedDeviceAccess:true}),{code:"AUTHENTICATION_FAILED"});
    await wizard.authenticate(started.id,{apiKey:"new-unique-key",confirmedDeviceAccess:true,confirmedLegacyMigration:true});
    wizard.skip(started.id,[1,2]);
    const result=wizard.save(started.id,{deviceName:"Legacy"},"owner");
    assert.equal(result.device.id,existing.id);
    assert.equal(repository.list()[0].deviceId,"LRC-AABBCCDDEEFF");
    assert.equal(repository.list()[0].previousDeviceId,"LRC-0001");
    assert.equal(repository.list()[0].apiKey,"new-unique-key");
    assert.deepEqual(tables,[{id:1,hardwareDeviceId:existing.id,relayChannel:1}]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
