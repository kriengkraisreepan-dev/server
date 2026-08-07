const crypto=require("crypto");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawn}=require("child_process");
const {FlasherError}=require("./firmware-package-service");
const {generateBase31SetupCode}=require("./hardware-setup-mode-service");

class PerDeviceNvsService {
  constructor({spawnProcess=spawn,randomBytes=crypto.randomBytes,clock=()=>Date.now(),tempRoot=os.tmpdir()}={}){Object.assign(this,{spawnProcess,randomBytes,clock,tempRoot});this.authorizations=new Map();}
  run(tool,args){return new Promise((resolve,reject)=>{const child=this.spawnProcess(tool,args,{shell:false,windowsHide:true});let output="";const take=chunk=>{output=`${output}${chunk}`.slice(-32768);};child.stdout?.on("data",take);child.stderr?.on("data",take);child.once("error",()=>reject(new FlasherError("NVS_GENERATOR_START_FAILED","ไม่สามารถเปิด NVS generator ได้",503)));child.once("close",code=>code===0?resolve():reject(Object.assign(new FlasherError("NVS_GENERATOR_FAILED","NVS generator ทำงานไม่สำเร็จ",409),{exitCode:code})));});}
  safeRemove(directory){if(!directory)return;try{const resolved=path.resolve(directory),root=path.resolve(this.tempRoot);if(resolved.startsWith(`${root}${path.sep}`)&&path.basename(resolved).startsWith("lucky-nvs-"))fs.rmSync(resolved,{recursive:true,force:true});}catch{}}
  async create({generatorPath,operationId,relayCount}){
    if(![2,4,8].includes(Number(relayCount)))throw new FlasherError("RELAY_COUNT_REQUIRED","กรุณาเลือก Relay Count 2, 4 หรือ 8",400);
    let deviceKey,setup;try{deviceKey=this.randomBytes(32).toString("base64url");setup=generateBase31SetupCode(this.randomBytes);}catch{throw new FlasherError("SECURE_RANDOM_UNAVAILABLE","ไม่สามารถสร้างข้อมูลอุปกรณ์อย่างปลอดภัย",503);}
    if(deviceKey.length<43)throw new FlasherError("SECURE_RANDOM_UNAVAILABLE","Device Key มี entropy ไม่เพียงพอ",503);
    const directory=fs.mkdtempSync(path.join(this.tempRoot,"lucky-nvs-"));try{fs.chmodSync(directory,0o700);}catch{}
    const csvPath=path.join(directory,"input.nvs.csv"),nvsPath=path.join(directory,"device.nvs.bin");
    const csv=["key,type,encoding,value","lucky-relay,namespace,,",`apiKey,data,string,${deviceKey}`,`setupCode,data,string,${setup.raw}`,"setupVersion,data,u8,1","wifiSSID,data,string,","wifiPassword,data,string,",`relayCount,data,u8,${Number(relayCount)}`].join("\n")+"\n";
    try{
      fs.writeFileSync(csvPath,csv,{encoding:"utf8",mode:0o600,flag:"wx"});
      await this.run(generatorPath,["generate",csvPath,nvsPath,"0x5000","--version","2"]);
      const stat=fs.statSync(nvsPath);if(stat.size!==0x5000)throw new FlasherError("NVS_SIZE_MISMATCH","NVS image มีขนาดไม่ถูกต้อง",409);
      const sha256=crypto.createHash("sha256").update(fs.readFileSync(nvsPath)).digest("hex"),expiresAt=this.clock()+120000;
      this.authorizations.set(operationId,{path:path.resolve(nvsPath),sha256,offset:"0x9000",size:0x5000,expiresAt,directory});
      return {path:nvsPath,offset:"0x9000",sha256,deviceKey,setupCode:setup.display,displayOnce:true};
    }catch(error){this.safeRemove(directory);throw error;}
  }
  verify(operationId){const record=this.authorizations.get(operationId);if(!record||record.expiresAt<this.clock()){this.cleanup(operationId);throw new FlasherError("NVS_AUTHORIZATION_EXPIRED","สิทธิ์ใช้ NVS image หมดอายุ",409);}let bytes;try{bytes=fs.readFileSync(record.path);}catch{throw new FlasherError("NVS_IMAGE_MISSING","ไม่พบ per-device NVS image",409);}const actual=crypto.createHash("sha256").update(bytes).digest("hex");if(bytes.length!==record.size||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(record.sha256)))throw new FlasherError("NVS_SESSION_INTEGRITY_FAILED","per-device NVS ไม่ผ่านการตรวจสอบ",409);return {...record};}
  cleanup(operationId){const record=this.authorizations.get(operationId);this.authorizations.delete(operationId);if(record)this.safeRemove(record.directory);}
}
module.exports={PerDeviceNvsService};
