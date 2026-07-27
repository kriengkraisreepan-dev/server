const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-sprint8c-")), port = 35000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(){for(let i=0;i<40;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)return;}catch{}await pause(100);}throw new Error("test server did not start");}
async function body(response){assert.match(response.headers.get("content-type")||"",/application\/json/);return response.json();}
(async()=>{try{
  await wait();
  let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});assert.strictEqual(response.status,200);const headers={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};
  response=await fetch(`${base}/api/tables/1/start`,{method:"POST",headers,body:"{}"});assert.strictEqual(response.status,200);
  response=await fetch(`${base}/api/state`,{headers});const state=await body(response),sessionId=state.tables.find(table=>String(table.id)==="1").runtimeSessionId;assert.ok(sessionId);
  response=await fetch(`${base}/api/pos-orders`,{method:"POST",headers,body:JSON.stringify({orderType:"TABLE",tableId:1})});const order=(await body(response)).order;
  response=await fetch(`${base}/api/pos-orders/${order.id}/items`,{method:"POST",headers,body:JSON.stringify({productId:"p-water",quantity:2})});assert.strictEqual(response.status,200);
  response=await fetch(`${base}/api/pos-orders/${order.id}/confirm`,{method:"POST",headers,body:"{}"});assert.strictEqual(response.status,200);
  response=await fetch(`${base}/api/table-sessions/${sessionId}/billing-preview`,{headers});assert.strictEqual(response.status,200);const preview=(await body(response)).preview;assert.strictEqual(preview.posOrders.length,1);
  response=await fetch(`${base}/api/table-sessions/${sessionId}/create-bill`,{method:"POST",headers,body:JSON.stringify({paymentMethod:"cash"})});assert.strictEqual(response.status,200);const created=await body(response);assert.strictEqual(created.bill.posOrderIds.length,1);assert.strictEqual(created.payment.status,"pending");
  response=await fetch(`${base}/api/table-sessions/${sessionId}/create-bill`,{method:"POST",headers,body:JSON.stringify({paymentMethod:"cash"})});assert.strictEqual(response.status,400);const duplicate=await body(response);assert.ok(duplicate.error);
  console.log("Sprint 8C billing route tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
