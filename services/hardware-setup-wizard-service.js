const crypto=require("crypto");
const { HardwareWizardError }=require("../domain/hardware-wizard-error");
const { SUPPORTED_RELAY_COUNTS }=require("../domain/hardware-device");

class HardwareSetupWizardService {
  constructor({driver,hardwareService,enabled=()=>true,log=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
    Object.assign(this,{driver,hardwareService,enabled,log,wait}); this.drafts=new Map(); this.activeTests=new Set();
  }
  assertEnabled(){if(!this.enabled()){const error=new HardwareWizardError("DEVICE_NOT_FOUND","Wizard disabled",404);error.userMessage="ตัวช่วยตั้งค่าถูกปิดใช้งาน";throw error;}}
  safeLog(event,draft,details={}){this.log("INFO",event,{draftId:draft?.id,deviceId:draft?.verification?.deviceId||null,...details});}
  start(actorId){this.assertEnabled();const draft={id:`hwd-${crypto.randomUUID()}`,actorId,step:"WELCOME",createdAt:new Date().toISOString(),testedChannels:[],skippedChannels:[]};this.drafts.set(draft.id,draft);this.safeLog("HARDWARE_WIZARD_STARTED",draft);return this.publicDraft(draft);}
  resumeEnrolled(device, verification, actorId) {
    this.assertEnabled();
    if (!device?.apiKey || !verification?.deviceId || device.deviceId !== verification.deviceId) throw new HardwareWizardError("AUTHENTICATION_FAILED", "Enrollment handoff ไม่สมบูรณ์", 409);
    const draft = {
      id: `hwd-${crypto.randomUUID()}`, actorId, step: "RELAY_TEST", createdAt: new Date().toISOString(),
      candidate: { ipAddress: device.ipAddress, port: device.port || 80, deviceType: "RELAY_CONTROLLER" },
      apiKey: device.apiKey, authenticationVerified: true, testedChannels: [], skippedChannels: [],
      verification: { deviceId: device.deviceId, deviceName: device.deviceName, firmwareVersion: device.firmwareVersion, apiVersion: device.apiVersion, hardwareStandard: device.hardwareStandard, boardModel: device.boardModel || null, relayCount: device.relayCount, relays: verification.relays || [] }
    };
    this.drafts.set(draft.id, draft); this.safeLog("HARDWARE_WIZARD_ENROLLMENT_RESUMED", draft);
    return this.publicDraft(draft);
  }
  discardEnrolled(id) { const draft=this.drafts.get(id);if(draft){draft.apiKey=undefined;this.drafts.delete(id);} }
  completeUsbAdoption(id, device, verification) {
    const draft=this.get(id);
    if(!device?.apiKey||device.deviceId!==draft.verification?.deviceId)throw new HardwareWizardError("AUTHENTICATION_FAILED","USB adoption handoff invalid",409);
    draft.apiKey=device.apiKey;draft.authenticationVerified=true;draft.step="RELAY_TEST";
    draft.verification={...draft.verification,...verification,deviceName:device.deviceName};
    this.safeLog("HARDWARE_WIZARD_USB_ADOPTION_RESUMED",draft);return this.publicDraft(draft);
  }
  get(id){const draft=this.drafts.get(id);if(!draft)throw new HardwareWizardError("OPERATION_CANCELLED","Draft missing",404);return draft;}
  publicDraft(draft){const {apiKey,...safe}=draft;return {...safe,hasApiKey:Boolean(apiKey)};}
  candidate(host,port=80){const value=String(host||"").trim().replace(/\.$/,"");if(/^https?:\/\//i.test(value)||/[/?#]/.test(value)||value==="127.0.0.1"||value==="localhost")throw new HardwareWizardError("DEVICE_NOT_FOUND","Invalid host");const candidate={ipAddress:value,port:Number(port)||80,apiKey:"",deviceType:"RELAY_CONTROLLER"};try{this.driver.endpoint(candidate);}catch(error){throw new HardwareWizardError("DEVICE_NOT_FOUND",error.message);}return candidate;}
  normalizeError(error){if(error instanceof HardwareWizardError)return error;const map={DEVICE_TIMEOUT:"DEVICE_TIMEOUT",DEVICE_OFFLINE:"NETWORK_UNREACHABLE",MALFORMED_DEVICE_RESPONSE:"INVALID_DEVICE_RESPONSE",API_VERSION_MISMATCH:"UNSUPPORTED_API_VERSION",INVALID_RELAY_COUNT:"RELAY_COUNT_MISMATCH",DEVICE_AUTH_FAILED:"AUTHENTICATION_FAILED"};return new HardwareWizardError(map[error.code]||"UNKNOWN_ERROR",`${error.code||error.name}: ${error.message}`,error.status||400);}
  async verify(id,{host,port=80}){
    const draft=this.get(id),started=Date.now();draft.step="VERIFYING";draft.candidate=this.candidate(host,port);this.safeLog("HARDWARE_WIZARD_VERIFICATION_STARTED",draft);
    try{
      const probe=await this.driver.probe(draft.candidate),{health,identity,config,relays}=probe;
      if(!health?.success||!identity?.success||!config?.success||!relays?.success||!identity.deviceId)throw new HardwareWizardError("INVALID_DEVICE_RESPONSE","Required fields missing");
      const counts=[health.relayCount,identity.relayCount,config.relayCount,relays.relayCount].map(Number);
      if(new Set(counts).size!==1||!SUPPORTED_RELAY_COUNTS.includes(counts[0]))throw new HardwareWizardError("RELAY_COUNT_MISMATCH",JSON.stringify(counts));
      if(health.deviceId&&health.deviceId!==identity.deviceId)throw new HardwareWizardError("DEVICE_ID_MISMATCH",`${health.deviceId}/${identity.deviceId}`);
      if(health.wifiConnected===false)throw new HardwareWizardError("WIFI_DISCONNECTED","wifiConnected=false");
      if(!Array.isArray(relays.relays)||relays.relays.length!==counts[0])throw new HardwareWizardError("INVALID_DEVICE_RESPONSE","Invalid relays array");
      const warning=String(identity.firmwareVersion||"").split(".")[0]!=="1";
      draft.verification={deviceId:identity.deviceId,previousDeviceId:identity.previousDeviceId||health.previousDeviceId||null,identityMigrationVersion:Number(identity.identityMigrationVersion??health.identityMigrationVersion??0),deviceName:identity.deviceName||health.deviceName||"",firmwareVersion:identity.firmwareVersion,apiVersion:String(identity.apiVersion),hardwareStandard:identity.hardwareStandard,boardModel:identity.boardModel,relayCount:counts[0],rssi:health.rssi,uptimeSeconds:health.uptimeSeconds,freeHeapBytes:health.freeHeapBytes,wifiConnected:health.wifiConnected,relays:relays.relays.map(x=>({channel:x.channel,state:x.state,gpio:x.gpio})),warning:warning?"UNKNOWN_NEWER_FIRMWARE":null};
      if(draft.verification.previousDeviceId&&draft.verification.identityMigrationVersion===1){try{draft.legacyMigration=this.hardwareService.legacyMigrationCandidate(draft.verification.previousDeviceId,draft.candidate.ipAddress);}catch(error){throw new HardwareWizardError("DEVICE_ID_MISMATCH",error.message,409);}}
      draft.step="AUTHENTICATION";this.safeLog("HARDWARE_WIZARD_VERIFICATION_COMPLETED",draft,{durationMs:Date.now()-started,firmwareVersion:identity.firmwareVersion,warning});return this.publicDraft(draft);
    }catch(error){draft.step="FIND_DEVICE";const normalized=this.normalizeError(error);this.log("ERROR","HARDWARE_WIZARD_VERIFICATION_FAILED",{draftId:draft.id,errorCode:normalized.code,durationMs:Date.now()-started,technicalDetail:normalized.technicalDetail});throw normalized;}
  }
  async authenticate(id,{confirmedDeviceAccess,confirmedAllOff,confirmedLegacyMigration,...forbidden}){
    const draft=this.get(id);if(!draft.verification)throw new HardwareWizardError("INVALID_DEVICE_RESPONSE","Verify first");if(!confirmedDeviceAccess&&!confirmedAllOff)throw new HardwareWizardError("AUTHENTICATION_FAILED","Device access confirmation required");if(draft.legacyMigration&&!confirmedLegacyMigration)throw new HardwareWizardError("AUTHENTICATION_FAILED","Legacy migration confirmation required");
    const repository=this.hardwareService.repository,developmentCompatibility=!repository?.secretVault;
    if(Object.keys(forbidden).some(key=>key!=="apiKey")||(!developmentCompatibility&&Object.keys(forbidden).length))throw new HardwareWizardError("AUTHENTICATION_REQUEST_REJECTED","Browser ต้องไม่ส่งข้อมูลรหัสอุปกรณ์",400);
    if(developmentCompatibility){draft.apiKey=String(forbidden.apiKey||"").trim();if(!draft.apiKey)throw new HardwareWizardError("AUTHENTICATION_FAILED","Missing key");const device={...draft.candidate,apiKey:draft.apiKey,relayCount:draft.verification.relayCount};try{const result=await this.driver.verifyDevice(device);if(!result?.success||result.verified!==true||result.deviceId!==draft.verification.deviceId)throw new Error("Invalid device verification response");draft.authenticationVerified=true;draft.legacyMigrationAuthorized=Boolean(draft.legacyMigration&&confirmedLegacyMigration);draft.step="RELAY_TEST";return this.publicDraft(draft);}catch(error){draft.apiKey=undefined;throw new HardwareWizardError("AUTHENTICATION_FAILED",error.message,error.status===401?401:400);}}
    if(draft.legacyMigration)throw new HardwareWizardError("USB_REAUTHENTICATION_REQUIRED","กล่องนี้ใช้ระบบรหัสรุ่นเก่า กรุณาเชื่อมต่อ USB เพื่ออัปเกรดและยืนยันอุปกรณ์อย่างปลอดภัย",409);
    const matches=this.hardwareService.repository.list().filter(device=>device.deviceId===draft.verification.deviceId);
    if(matches.length!==1)throw new HardwareWizardError(matches.length?"DEVICE_ID_AMBIGUOUS":"USB_REAUTHENTICATION_REQUIRED",matches.length?"พบ Device ID ซ้ำ จึงหยุดการยืนยันเพื่อความปลอดภัย":"ไม่พบรหัสอุปกรณ์ที่ปลอดภัยสำหรับกล่องนี้ กรุณายืนยันอุปกรณ์อีกครั้งผ่าน USB",409);
    const stored=matches[0];if(!stored.apiKey||stored.credentialStatus==="REAUTHENTICATION_REQUIRED")throw new HardwareWizardError("USB_REAUTHENTICATION_REQUIRED","ต้องยืนยันอุปกรณ์อีกครั้งผ่าน USB",409);
    draft.apiKey=stored.apiKey;const device={...draft.candidate,apiKey:draft.apiKey,relayCount:draft.verification.relayCount};
    try{const result=await this.driver.verifyDevice(device);if(!result?.success||result.verified!==true||result.deviceId!==draft.verification.deviceId||Number(result.identityMigrationVersion||0)!==draft.verification.identityMigrationVersion||String(result.previousDeviceId||"")!==String(draft.verification.previousDeviceId||""))throw new Error("Invalid device verification response");draft.authenticationVerified=true;draft.legacyMigrationAuthorized=Boolean(draft.legacyMigration&&confirmedLegacyMigration);draft.step="RELAY_TEST";this.safeLog("HARDWARE_WIZARD_AUTHENTICATION_SUCCEEDED",draft);return this.publicDraft(draft);}catch(error){draft.apiKey=undefined;this.log("ERROR","HARDWARE_WIZARD_AUTHENTICATION_FAILED",{draftId:draft.id,errorCode:error.code||"AUTHENTICATION_FAILED"});throw new HardwareWizardError("AUTHENTICATION_FAILED",error.message,error.status===401?401:400);}
  }
  device(draft){return {...draft.candidate,apiKey:draft.apiKey,relayCount:draft.verification.relayCount};}
  async emergencyOff(id){const draft=this.get(id);if(!draft.apiKey)throw new HardwareWizardError("AUTHENTICATION_FAILED","No key");try{const result=await this.driver.allOff(this.device(draft));this.safeLog("HARDWARE_WIZARD_CLEANUP_SUCCEEDED",draft);return result;}catch(error){this.log("ERROR","HARDWARE_WIZARD_CLEANUP_FAILED",{draftId:draft.id,errorCode:error.code||"RELAY_CLEANUP_FAILED"});throw new HardwareWizardError("RELAY_CLEANUP_FAILED",error.message,503);}}
  async testRelay(id,{channel,durationMs=1000}){
    const draft=this.get(id),key=draft.id;if(!draft.authenticationVerified)throw new HardwareWizardError("AUTHENTICATION_FAILED","Authenticate first");if(this.activeTests.has(key))throw new HardwareWizardError("RELAY_TEST_FAILED","Concurrent test",409);
    const relay=Number(channel),duration=Math.min(3000,Math.max(100,Number(durationMs)||1000));if(!Number.isInteger(relay)||relay<1||relay>draft.verification.relayCount)throw new HardwareWizardError("RELAY_TEST_FAILED","Invalid channel");
    this.activeTests.add(key);this.safeLog("HARDWARE_WIZARD_RELAY_TEST_STARTED",draft,{relayChannel:relay});
    let primaryError=null;
    try{await this.driver.allOff(this.device(draft));await this.driver.setRelayState(this.device(draft),relay,true);await this.wait(duration);await this.driver.setRelayState(this.device(draft),relay,false);const state=await this.driver.relays(this.device(draft)),item=state.relays?.find(x=>Number(x.channel)===relay);if(!item||item.state!=="OFF")throw new Error("Relay did not verify OFF");if(!draft.testedChannels.includes(relay))draft.testedChannels.push(relay);this.safeLog("HARDWARE_WIZARD_RELAY_TEST_SUCCEEDED",draft,{relayChannel:relay});return this.publicDraft(draft);}catch(error){primaryError=error;this.log("ERROR","HARDWARE_WIZARD_RELAY_TEST_FAILED",{draftId:draft.id,relayChannel:relay,errorCode:error.code||"RELAY_TEST_FAILED"});throw new HardwareWizardError("RELAY_TEST_FAILED",error.message,503);}finally{try{await this.driver.setRelayState(this.device(draft),relay,false);}catch{}try{await this.driver.allOff(this.device(draft));}catch(error){if(!primaryError)this.log("ERROR","HARDWARE_WIZARD_CLEANUP_FAILED",{draftId:draft.id,relayChannel:relay,errorCode:error.code||"RELAY_CLEANUP_FAILED"});}this.activeTests.delete(key);}}
  skip(id,channels){const draft=this.get(id);draft.skippedChannels=[...new Set((channels||[]).map(Number).filter(x=>x>=1&&x<=draft.verification.relayCount))];draft.step="NAMING";return this.publicDraft(draft);}
  naming(id){const draft=this.get(id),all=Array.from({length:draft.verification.relayCount},(_,i)=>i+1);if(!all.every(x=>draft.testedChannels.includes(x)||draft.skippedChannels.includes(x)))throw new HardwareWizardError("RELAY_TEST_FAILED","Incomplete tests");draft.step="NAMING";return this.publicDraft(draft);}
  save(id,metadata,actorId){const draft=this.get(id);if(!draft.authenticationVerified||draft.step!=="NAMING")throw new HardwareWizardError("SAVE_FAILED","Wizard incomplete");try{const warning=draft.skippedChannels.length>0||draft.verification.warning;const result=this.hardwareService.saveVerifiedSetup({...draft.candidate,apiKey:draft.apiKey,deviceType:"RELAY_CONTROLLER"},draft.verification,{...metadata,verificationStatus:warning?"WARNING":"PASSED",relayTestStatus:draft.skippedChannels.length?"PARTIAL":"PASSED",relayTestedChannels:draft.testedChannels,legacyMigrationRecordId:draft.legacyMigration?.id,legacyMigrationAuthorized:draft.legacyMigrationAuthorized===true},actorId);this.safeLog("HARDWARE_WIZARD_COMPLETED",draft);draft.apiKey=undefined;this.drafts.delete(id);return result;}catch(error){this.log("ERROR","HARDWARE_WIZARD_SAVE_FAILED",{draftId:draft.id,errorCode:error.code||"SAVE_FAILED"});if(error.code)throw error;throw new HardwareWizardError("SAVE_FAILED",error.message,500);}}
  async cancel(id){const draft=this.get(id);if(draft.apiKey)try{await this.driver.allOff(this.device(draft));}catch(error){this.log("ERROR","HARDWARE_WIZARD_CLEANUP_FAILED",{draftId:draft.id,errorCode:error.code||"RELAY_CLEANUP_FAILED"});}draft.apiKey=undefined;this.drafts.delete(id);this.safeLog("HARDWARE_WIZARD_CANCELLED",draft);return {cancelled:true};}
}
module.exports={HardwareSetupWizardService};
