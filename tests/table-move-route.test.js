const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-move-")), port = 39500 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${port}`;
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
  const state=async()=>body(await get("/api/state"));
  const tableOf=async id=>(await state()).tables.find(table=>String(table.id)===String(id));

  const member=(await body(await post("/api/members",{displayName:"คุณย้ายโต๊ะ",memberCode:"MV001"}))).member;
  const products=(await body(await get("/api/products?pageSize=5"))).items;

  assert.strictEqual((await post("/api/tables/1/start",{memberId:member.id})).status,200);
  const session=(await tableOf(1)).runtimeSessionId;

  // Food rung up on table 1 before the move.
  const order=(await body(await post("/api/pos-orders",{orderType:"TABLE",tableId:"1"}))).order;
  await post(`/api/pos-orders/${order.id}/items`,{productId:products[0].id,quantity:2});
  assert.strictEqual((await post(`/api/pos-orders/${order.id}/confirm`)).status,200);

  assert.strictEqual((await post("/api/tables/1/move",{targetTableId:"1"})).status,400,"moving a table onto itself is refused");

  // Table 2 is occupied, so it is not a valid destination.
  assert.strictEqual((await post("/api/tables/2/start")).status,200);
  response=await post("/api/tables/1/move",{targetTableId:"2"});
  assert.strictEqual(response.status,409);
  assert.strictEqual((await body(response)).error,"TABLE_NOT_FREE");
  assert.strictEqual((await tableOf(1)).runtimeSessionId,session,"a refused move must leave the session exactly where it was");

  const before=await tableOf(1);
  response=await post("/api/tables/1/move",{targetTableId:"3"});
  assert.strictEqual(response.status,200);
  const moved=await body(response);
  assert.strictEqual(moved.posOrdersMoved,1);

  const from=await tableOf(1),to=await tableOf(3);
  assert.strictEqual(from.status,"free","the old table is handed back");
  assert.strictEqual(from.runtimeSessionId,null);
  assert.strictEqual(from.memberId,null);
  assert.strictEqual(to.status,"playing");
  assert.strictEqual(to.runtimeSessionId,session,"the SAME session continues — a move is not a new sale");
  assert.strictEqual(to.memberId,member.id);
  assert.strictEqual(to.startTime,before.startTime,"the clock keeps running from when they sat down");
  assert.ok(to.elapsedSeconds>=before.elapsedSeconds,"time already played is not reset by the move");

  // The POS order has to follow, or CombinedBillingService#ordersForSession (which matches on the
  // table AND the session) would orphan the food from the bill.
  const followedOrder=(await body(await get(`/api/pos-orders/${order.id}`))).order;
  assert.strictEqual(String(followedOrder.tableId),"3");
  assert.strictEqual(followedOrder.tableName,to.name);
  assert.strictEqual(followedOrder.tableSessionId,session);

  const preview=(await body(await get(`/api/table-sessions/${session}/billing-preview`))).preview;
  assert.strictEqual(preview.tableId,3);
  assert.ok(preview.breakdown.productSatang>0,"the food rung up before the move is still on the bill");

  // A paused table can be moved too — the customer stepping away is exactly when tables get swapped.
  assert.strictEqual((await post("/api/tables/3/pause")).status,200);
  assert.strictEqual((await post("/api/tables/3/move",{targetTableId:"1"})).status,200);
  const paused=await tableOf(1);
  assert.strictEqual(paused.status,"paused");
  assert.strictEqual(paused.runtimeSessionId,session);

  // The bill still adds up, and the session that opened on table 1 bills on the table it ended on.
  assert.strictEqual((await post("/api/tables/1/resume")).status,200);
  const created=await body(await post(`/api/table-sessions/${session}/create-bill`,{paymentMethod:"cash"}));
  assert.strictEqual(created.bill.tableSessionId,session);
  assert.strictEqual(created.bill.playAmountSatang+created.bill.foodAmountSatang,created.bill.totalSatang);
  assert.ok(created.bill.foodAmountSatang>0,"the food followed all the way onto the bill");
  assert.strictEqual((await post(`/api/payments/${created.payment.id}/confirm`)).status,200);

  // A table with nothing on it has nothing to move.
  response=await post("/api/tables/3/move",{targetTableId:"1"});
  assert.strictEqual(response.status,409);
  assert.strictEqual((await body(response)).error,"NO_ACTIVE_SESSION");

  // The rate the customer was quoted when they sat down follows them. Moving onto a table that is
  // priced differently must not silently re-rate the time they have already played — and re-pricing
  // mid-session would also mean re-cutting the Happy Hour segments around the move.
  const settings=(await state()).settings;
  const defaultProfile=settings.pricingProfiles.find(profile=>profile.id===settings.defaultPricingProfileId)||settings.pricingProfiles[0];
  const vip={id:"vip",name:"VIP",rateSatang:defaultProfile.rateSatang*3,minimumChargeSatang:defaultProfile.minimumChargeSatang,timeRules:[]};
  assert.strictEqual((await fetch(`${base}/api/settings`,{method:"PUT",headers,body:JSON.stringify({...settings,pricingProfiles:[...settings.pricingProfiles,vip]})})).status,200);
  assert.strictEqual((await fetch(`${base}/api/tables/3/pricing-profile`,{method:"PUT",headers,body:JSON.stringify({pricingProfileId:"vip"})})).status,200);

  // Table 2 has been running since the TABLE_NOT_FREE check above; clear it and start fresh.
  assert.strictEqual((await post("/api/tables/2/cancel")).status,200);
  assert.strictEqual((await post("/api/tables/2/start")).status,200);
  const quotedSession=(await tableOf(2)).runtimeSessionId;
  assert.strictEqual((await post("/api/tables/2/move",{targetTableId:"3"})).status,200);
  const quotedBill=(await body(await post(`/api/table-sessions/${quotedSession}/create-bill`,{paymentMethod:"cash"}))).bill;
  assert.strictEqual(quotedBill.pricingSnapshot.rateSatang,defaultProfile.rateSatang,"the bill keeps the rate quoted at the original table, not the VIP table's");
  assert.notStrictEqual(quotedBill.pricingSnapshot.rateSatang,vip.rateSatang);

  const audit=await body(await get("/api/audit-logs?event=TABLE_SESSION_MOVED"));
  assert.strictEqual(audit.items.length,3,"every move is on the record");
  // The order followed on both legs of the 1 -> 3 -> 1 journey; the last move carried no food.
  assert.deepStrictEqual(audit.items.map(entry=>entry.details.posOrdersMoved).sort(),[0,1,1]);
  const firstMove=audit.items.find(entry=>String(entry.details.fromTableId)==="1");
  assert.strictEqual(String(firstMove.details.toTableId),"3");
  assert.strictEqual(firstMove.details.toTableName,(await tableOf(3)).name);

  console.log("Table move route tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
