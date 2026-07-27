const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-8c1-")), port = 36000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(){for(let i=0;i<40;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)return;}catch{}await sleep(100);}throw new Error("test server did not start");}
async function json(response){assert.match(response.headers.get("content-type")||"",/application\/json/);return response.json();}
(async()=>{try{
  await wait();
  let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});const headers={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};
  response=await fetch(`${base}/api/pos-orders`,{method:"POST",headers,body:JSON.stringify({orderType:"WALK_IN"})});assert.strictEqual(response.status,201);const order=(await json(response)).order;
  response=await fetch(`${base}/api/pos-orders/${order.id}/items`,{method:"POST",headers,body:JSON.stringify({productId:"p-water",quantity:2})});assert.strictEqual(response.status,200);
  response=await fetch(`${base}/api/pos-orders/${order.id}/confirm`,{method:"POST",headers,body:"{}"});assert.strictEqual(response.status,200);
  response=await fetch(`${base}/api/pos-orders/${order.id}/billing-preview`,{headers});assert.strictEqual(response.status,200);const preview=await json(response);assert.strictEqual(preview.saleSource,"WALK_IN");assert.strictEqual(preview.total,30);
  response=await fetch(`${base}/api/pos-orders/${order.id}/create-bill`,{method:"POST",headers,body:JSON.stringify({paymentMethod:"cash"})});assert.strictEqual(response.status,200);const created=await json(response);assert.strictEqual(created.bill.saleSource,"WALK_IN");assert.strictEqual(created.bill.playAmount,0);assert.strictEqual(created.bill.foodAmount,30);assert.strictEqual(created.order.billingStatus,"BILLED");
  response=await fetch(`${base}/api/pos-orders/${order.id}/create-bill`,{method:"POST",headers,body:JSON.stringify({paymentMethod:"cash"})});assert.strictEqual(response.status,409);assert.strictEqual((await json(response)).error,"ORDER_ALREADY_BILLED");
  response=await fetch(`${base}/api/payments/${created.payment.id}/confirm`,{method:"POST",headers,body:"{}"});assert.strictEqual(response.status,200);
  response=await fetch(`${base}/api/reports/summary`,{headers});const report=await json(response);assert.strictEqual(report.posRevenue,30);assert.strictEqual(report.tableRevenue,0);
  console.log("Sprint 8C.1 walk-in checkout tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
