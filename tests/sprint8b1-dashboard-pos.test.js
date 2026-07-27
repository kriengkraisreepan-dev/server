const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), source = fs.readFileSync(path.join(root, "public", "js", "app.js"), "utf8");
assert.match(source, /api\/security\/summary/);
assert.match(source, /page==="dashboard".*loadSecuritySummary/);
assert.match(source, /lucky_pos_draft_/);
assert.match(source, /table:\$\{posContext\.tableId\}/);
assert.match(source, /order\.tableId\)===String\(posContext\.tableId\)/);
assert.match(source, /เพิ่มอาหาร\/เครื่องดื่ม/);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-dashboard-")), port = 35000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
async function wait(){for(let i=0;i<40;i+=1){try{const response=await fetch(`${base}/api/security/summary`);if(response.status===401)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error("server did not start");}
async function call(pathname, options={},cookie=" "){const response=await fetch(`${base}${pathname}`,{...options,headers:{"Content-Type":"application/json",...(cookie.trim()?{Cookie:cookie.trim()}:{}),...(options.headers||{})}});assert.match(response.headers.get("content-type")||"",/application\/json/);return {response,body:await response.json()};}
(async()=>{try{await wait();let result=await call("/api/security/summary");assert.equal(result.response.status,401);result=await call("/api/auth/login",{method:"POST",body:JSON.stringify({username:"admin",password:"123456789"})});const cookie=result.response.headers.get("set-cookie").split(";")[0];result=await call("/api/security/summary",{},cookie);assert.equal(result.response.status,200);assert.deepEqual(Object.keys(result.body).sort(),["activeSessions","disabledUsers","lockedAccounts","onlineUsers"]);result=await call("/api/unknown-security-route",{},cookie);assert.equal(result.response.status,404);console.log("Sprint 8B.1 dashboard and POS context tests passed");}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
