const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-discount-")), port = 36000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(){for(let i=0;i<40;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)return;}catch{}await pause(100);}throw new Error("test server did not start");}
async function body(response){assert.match(response.headers.get("content-type")||"",/application\/json/);return response.json();}
(async()=>{try{
  await wait();
  let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});assert.strictEqual(response.status,200);
  const headers={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};

  response=await fetch(`${base}/api/tables/1/start`,{method:"POST",headers,body:"{}"});assert.strictEqual(response.status,200);
  response=await fetch(`${base}/api/state`,{headers});const state=await body(response),sessionId=state.tables.find(table=>String(table.id)==="1").runtimeSessionId;assert.ok(sessionId);

  // Preview with no discount yet — baseline sanity check that the routes still work with the new param optional.
  response=await fetch(`${base}/api/table-sessions/${sessionId}/billing-preview`,{headers});assert.strictEqual(response.status,200);
  const preview=(await body(response)).preview;
  const rawTableCharge=preview.breakdown.tableChargeBeforeDiscount ?? preview.breakdown.tableCharge;
  assert.ok(rawTableCharge >= 0);

  // A discount larger than the table charge must be capped, not rejected, and must land in the bill's discount field.
  const hugeDiscount=rawTableCharge+9999;
  response=await fetch(`${base}/api/table-sessions/${sessionId}/create-bill`,{method:"POST",headers,body:JSON.stringify({paymentMethod:"cash",discountAmount:hugeDiscount,discountReason:"HTTP route test"})});
  assert.strictEqual(response.status,200,`create-bill with an over-large discount must succeed (capped), got ${response.status}`);
  const created=await body(response);
  assert.strictEqual(created.bill.discount, rawTableCharge, "the applied discount must be capped at the raw table charge, not the requested amount");
  assert.strictEqual(created.bill.discountReason, "HTTP route test");
  assert.strictEqual(created.bill.playAmount, 0, "table charge must be fully discounted");
  assert.strictEqual(created.bill.playAmount + created.bill.foodAmount, created.bill.total, "tableCharge + products must equal total on the real bill returned by the API");

  // A negative discount amount must be rejected outright.
  response=await fetch(`${base}/api/tables/2/start`,{method:"POST",headers,body:"{}"});assert.strictEqual(response.status,200);
  response=await fetch(`${base}/api/state`,{headers});const state2=await body(response),sessionId2=state2.tables.find(table=>String(table.id)==="2").runtimeSessionId;
  response=await fetch(`${base}/api/table-sessions/${sessionId2}/create-bill`,{method:"POST",headers,body:JSON.stringify({paymentMethod:"cash",discountAmount:-5})});
  assert.strictEqual(response.status,400,"a negative discount amount must be rejected");
  const rejected=await body(response);
  assert.strictEqual(rejected.error,"INVALID_DISCOUNT_AMOUNT");

  console.log("Discount billing route tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
