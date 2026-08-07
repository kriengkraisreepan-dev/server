const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawn}=require("child_process");

test("production health, integrity, backup, restore and lifecycle logs are operational",{timeout:15000},async()=>{
  const root=path.resolve(__dirname,".."),dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"lucky-sprint10e-")),port=40000+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`;
  let output="";
  const child=spawn(process.execPath,["index.js"],{cwd:root,env:{...process.env,PORT:String(port),LUCKY_DATA_DIR:dataDir},stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);
  try{
    for(let attempt=0;attempt<60;attempt+=1){try{if((await fetch(`${base}/api/health`)).status===401)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));if(attempt===59)throw new Error("server did not start");}
    let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});assert.equal(response.status,200);const cookie=response.headers.get("set-cookie").split(";")[0];
    response=await fetch(`${base}/api/health`,{headers:{Cookie:cookie}});assert.equal(response.status,200);const health=await response.json();assert.ok(["HEALTHY","WARNING"].includes(health.status));
    response=await fetch(`${base}/api/integrity`,{headers:{Cookie:cookie}});assert.equal(response.status,200);const integrity=await response.json();assert.ok(["PASS","WARNING"].includes(integrity.status));
    response=await fetch(`${base}/api/backups`,{method:"POST",headers:{Cookie:cookie,"Content-Type":"application/json"},body:"{}"});assert.equal(response.status,201);const backup=await response.json();assert.equal(backup.verificationStatus,"VERIFIED");
    response=await fetch(`${base}/api/backups/${encodeURIComponent(backup.file)}/restore`,{method:"POST",headers:{Cookie:cookie,"Content-Type":"application/json"},body:"{}"});assert.equal(response.status,200);
    child.kill();
    await new Promise(resolve=>child.once("exit",resolve));
    for(const event of ["SERVER_STARTED","BACKUP_VERIFIED","RESTORE_COMPLETED"])assert.match(output,new RegExp(`"event":"${event}"`),event);
    const source=fs.readFileSync(path.join(root,"index.js"),"utf8");for(const event of ["SERVER_SHUTDOWN","SERVER_STOPPED","UNCAUGHT_EXCEPTION","UNHANDLED_REJECTION"])assert.match(source,new RegExp(`"${event}"`),event);
  }finally{
    if(child.exitCode===null)child.kill();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
});
