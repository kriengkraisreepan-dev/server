const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-planned-")), port = 40500 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(){for(let i=0;i<40;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)return;}catch{}await pause(100);}throw new Error("test server did not start");}
async function body(response){assert.match(response.headers.get("content-type")||"",/application\/json/);return response.json();}

(async()=>{try{
  await wait();
  let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});
  const headers={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};
  const get=url=>fetch(`${base}${url}`,{headers});
  const post=(url,payload)=>fetch(`${base}${url}`,{method:"POST",headers,body:JSON.stringify(payload||{})});
  const tableOf=async id=>(await body(await get("/api/state"))).tables.find(table=>String(table.id)===String(id));

  // ---- opening with a limit --------------------------------------------------------------------
  assert.strictEqual((await post("/api/tables/1/start",{plannedMinutes:90})).status,200);
  let table=await tableOf(1);
  assert.strictEqual(table.plannedSeconds,5400,"90 minutes is stored as seconds");
  assert.ok(table.remainingSeconds<=5400&&table.remainingSeconds>5390,"the countdown starts from the full amount");

  await pause(1200);
  const later=await tableOf(1);
  assert.ok(later.remainingSeconds<table.remainingSeconds,"the countdown runs down as they play");

  // ---- pausing the table pauses the countdown ---------------------------------------------------
  // Otherwise a table paused for twenty minutes would announce that the customer's time was up
  // while nobody was playing on it.
  assert.strictEqual((await post("/api/tables/1/pause")).status,200);
  const atPause=(await tableOf(1)).remainingSeconds;
  await pause(1500);
  assert.strictEqual((await tableOf(1)).remainingSeconds,atPause,"a paused table does not burn the customer's time");
  assert.strictEqual((await post("/api/tables/1/resume")).status,200);

  // ---- extending and clearing on a running table ------------------------------------------------
  response=await post("/api/tables/1/planned-time",{plannedMinutes:120});
  assert.strictEqual(response.status,200);
  assert.strictEqual((await body(response)).plannedSeconds,7200,"the customer asked for another half hour");
  response=await post("/api/tables/1/planned-time",{plannedMinutes:0});
  assert.strictEqual(response.status,200);
  const cleared=await body(response);
  assert.strictEqual(cleared.plannedSeconds,0);
  assert.strictEqual(cleared.remainingSeconds,null,"no limit means no countdown, not a countdown of zero");

  // ---- refusals ---------------------------------------------------------------------------------
  assert.strictEqual((await post("/api/tables/1/planned-time",{plannedMinutes:-5})).status,400);
  assert.strictEqual((await post("/api/tables/1/planned-time",{plannedMinutes:25*60})).status,400,"a limit longer than a day is a typo");
  response=await post("/api/tables/2/planned-time",{plannedMinutes:60});
  assert.strictEqual(response.status,409,"a table that is not open has no time to plan");
  assert.strictEqual((await body(response)).error,"NO_ACTIVE_SESSION");

  // ---- the limit is a reminder, never a charge --------------------------------------------------
  // Running past it must not change what the customer pays, and must not stop the table either.
  assert.strictEqual((await post("/api/tables/3/start",{plannedMinutes:1/60})).status,200,"one second, so it is over almost immediately");
  await pause(2500);
  const overdue=await tableOf(3);
  assert.strictEqual(overdue.plannedSeconds,1);
  assert.ok(overdue.remainingSeconds<0,"the table is over its time");
  assert.strictEqual(overdue.status,"playing","being over time does not stop the table");

  const session=overdue.runtimeSessionId;
  const overdueBill=(await body(await post(`/api/table-sessions/${session}/create-bill`,{paymentMethod:"cash"}))).bill;
  const plainStart=await post("/api/tables/2/start");
  assert.strictEqual(plainStart.status,200);
  const plainSession=(await tableOf(2)).runtimeSessionId;
  const plainBill=(await body(await post(`/api/table-sessions/${plainSession}/create-bill`,{paymentMethod:"cash"}))).bill;
  assert.strictEqual(overdueBill.playAmountSatang,plainBill.playAmountSatang,"a table that ran over its planned time is charged exactly like one that never had a limit");
  assert.ok(!("plannedSeconds" in overdueBill)||overdueBill.plannedSeconds===undefined,"the limit is not a billing input");

  const audit=await body(await get("/api/audit-logs?event=TABLE_PLANNED_TIME_SET"));
  // Opening with a limit is part of TABLE_OPENED; only later changes get their own event.
  assert.strictEqual(audit.items.length,2,"extending and clearing are both on the record");
  assert.strictEqual(audit.items[0].details.plannedSeconds,0,"newest first: the clear");
  assert.strictEqual(audit.items[1].details.plannedSeconds,7200);
  const opened=await body(await get("/api/audit-logs?event=TABLE_OPENED"));
  assert.ok(opened.items.some(entry=>entry.details.plannedSeconds===5400),"the limit a table was opened with is on the record too");

  console.log("Table planned-time tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
