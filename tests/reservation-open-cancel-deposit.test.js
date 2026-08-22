const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-res-deposit-")), port = 40000 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(){for(let i=0;i<40;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)return;}catch{}await pause(100);}throw new Error("test server did not start");}
async function body(response){assert.match(response.headers.get("content-type")||"",/application\/json/);return response.json();}

(async()=>{try{
  await wait();
  let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});
  const headers={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};
  const get=url=>fetch(`${base}${url}`,{headers});
  const post=(url,payload,as=headers)=>fetch(`${base}${url}`,{method:"POST",headers:as,body:JSON.stringify(payload||{})});
  const patch=(url,payload,as=headers)=>fetch(`${base}${url}`,{method:"PATCH",headers:as,body:JSON.stringify(payload||{})});
  const tableOf=async id=>(await body(await get("/api/state"))).tables.find(table=>String(table.id)===String(id));
  // The reporting day rolls at 06:00, not at midnight — see index.js dayShiftMs.
  const businessDay=()=>new Date(Date.now()+(7-6)*60*60*1000).toISOString().slice(0,10);
  const analytics=async()=>body(await get(`/api/reports/analytics?type=day&period=${businessDay()}`));
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const bookFor=async(name,time="20:00")=>(await body(await post("/api/reservations",{customerName:name,phone:"0812345678",reservationDate:tomorrow,reservationTime:time,amountSatang:10000,paymentMethod:"cash",paymentConfirmed:true})));

  // ---- the customer turns up early ------------------------------------------------------------
  const early=await bookFor("มาก่อนเวลา");
  assert.strictEqual((await body(await get("/api/reservations"))).items.find(item=>item.id===early.reservation.id).status,"BOOKED");

  // Three tables are free, so staff get to say which one — and the choice must be honoured rather
  // than quietly overridden by "the first free table".
  response=await post(`/api/reservations/${early.reservation.id}/open-now`,{tableId:"3"});
  assert.strictEqual(response.status,200,"a booking can be opened before its time when the customer walks in early");
  const opened=await body(response);
  assert.strictEqual(String(opened.table.id),"3","the chosen table is the one opened");
  assert.strictEqual(opened.reservation.status,"OPENED_WAITING_CHECK_IN");
  assert.strictEqual(String(opened.reservation.assignedTableId),"3");
  assert.strictEqual((await tableOf(3)).status,"playing");
  assert.strictEqual((await tableOf(1)).status,"free","the other free tables are left alone");
  assert.ok(opened.reservation.timeline.some(entry=>entry.event==="RESERVATION_OPENED_EARLY"),"the record says the customer came early");

  // ---- a table that is not free cannot be chosen -----------------------------------------------
  const second=await bookFor("เลือกโต๊ะที่ไม่ว่าง");
  response=await post(`/api/reservations/${second.reservation.id}/open-now`,{tableId:"3"});
  assert.strictEqual(response.status,400);
  assert.strictEqual((await body(response)).error,"TABLE_NOT_FREE");
  assert.strictEqual((await body(await get("/api/reservations"))).items.find(item=>item.id===second.reservation.id).status,"BOOKED","a refused open leaves the booking alone");

  // ---- cancelling and keeping the money --------------------------------------------------------
  const forfeited=await bookFor("ไม่คืนเงิน");
  const incomeBefore=(await analytics()).totalIncome;
  response=await patch(`/api/reservations/${forfeited.reservation.id}/cancel`,{depositAction:"FORFEIT"});
  assert.strictEqual(response.status,200);
  const afterForfeit=await body(response);
  assert.strictEqual(afterForfeit.reservation.status,"CANCELLED");
  assert.strictEqual(afterForfeit.deposit.status,"FORFEITED");
  assert.ok(afterForfeit.deposit.revenueRecognizedAt,"the money is recognised as income there and then");

  let report=await analytics();
  assert.strictEqual(report.forfeitedDepositSatang,10000);
  assert.strictEqual(report.forfeitedDepositCount,1);
  assert.strictEqual(report.totalIncome,Number((incomeBefore+100).toFixed(2)),"the kept deposit lands in the shop's income");
  assert.strictEqual(report.revenue,incomeBefore,"…without being smuggled into bill revenue, which still has to reconcile with billCount");

  // ---- cancelling and giving the money back ----------------------------------------------------
  const refunded=await bookFor("คืนเงิน");
  response=await patch(`/api/reservations/${refunded.reservation.id}/cancel`,{depositAction:"REFUND"});
  assert.strictEqual(response.status,200);
  assert.strictEqual((await body(response)).deposit.status,"REFUNDED");

  report=await analytics();
  assert.strictEqual(report.refundedDepositSatang,10000);
  assert.strictEqual(report.refundedDepositCount,1);
  assert.strictEqual(report.forfeitedDepositSatang,10000,"a refund must never be counted as a forfeit");
  assert.strictEqual(report.totalIncome,Number((incomeBefore+100).toFixed(2)),"refunded money never reaches the shop's income");

  // ---- who may do what -------------------------------------------------------------------------
  assert.strictEqual((await post("/api/users",{username:"cashier2",password:"cashier12345",displayName:"แคชเชียร์",role:"CASHIER"})).status,201);
  response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"cashier2",password:"cashier12345"})});
  const cashier={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};

  const cashierRefund=await bookFor("แคชเชียร์คืนเงิน");
  response=await patch(`/api/reservations/${cashierRefund.reservation.id}/cancel`,{depositAction:"REFUND"},cashier);
  assert.strictEqual(response.status,403,"handing money back is an owner/manager decision");
  const stillOpen=(await body(await get("/api/reservations"))).items.find(item=>item.id===cashierRefund.reservation.id);
  assert.strictEqual(stillOpen.status,"BOOKED","a refused cancel must not leave the booking cancelled with the deposit in limbo");

  // Keeping the money is the lower-risk direction and stays with whoever can cancel a booking.
  response=await patch(`/api/reservations/${cashierRefund.reservation.id}/cancel`,{depositAction:"FORFEIT"},cashier);
  assert.strictEqual(response.status,200);
  assert.strictEqual((await body(response)).deposit.status,"FORFEITED");

  // ---- once the table is open, cancelling is no longer the way out ------------------------------
  response=await patch(`/api/reservations/${early.reservation.id}/cancel`,{depositAction:"FORFEIT"});
  assert.strictEqual(response.status,400,"an opened booking is handled by check-in or no-show, not cancel");

  // ---- a deposit can only be settled once ------------------------------------------------------
  response=await patch(`/api/reservations/${forfeited.reservation.id}/cancel`,{depositAction:"REFUND"});
  assert.strictEqual(response.status,400,"an already-cancelled booking cannot be cancelled again");

  console.log("Reservation open/cancel deposit tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
