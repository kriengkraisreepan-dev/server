const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-coupon-report-")), port = 38500 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${port}`;
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
  const del=(url,payload)=>fetch(`${base}${url}`,{method:"DELETE",headers,body:JSON.stringify(payload||{})});
  const sessionOf=async tableId=>((await body(await get("/api/state"))).tables.find(table=>String(table.id)===String(tableId))).runtimeSessionId;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const analytics=async()=>body(await get(`/api/reports/analytics?type=day&period=${today}`));

  // Nothing has happened yet, so the report must be honestly empty rather than absent.
  let report=await analytics();
  assert.strictEqual(report.couponDiscount,0);
  assert.strictEqual(report.couponRedemptions,0);
  assert.deepStrictEqual(report.topCoupons,[]);
  assert.strictEqual(report.outstandingCouponReservations,0);

  const memberA=(await body(await post("/api/members",{displayName:"สมาชิก ก",memberCode:"RA001"}))).member;
  const memberB=(await body(await post("/api/members",{displayName:"สมาชิก ข",memberCode:"RB002"}))).member;
  const coupon=(await body(await post("/api/coupons",{name:"ลดค่าโต๊ะ 20 บาท",discountType:"FIXED",discountValue:2000,scope:"TABLE_CHARGE",channels:["TABLE"],status:"ACTIVE",perMemberLimit:0}))).coupon;

  // Two paid table sales on the same coupon, by two different members.
  for (const [tableId,member] of [["1",memberA],["2",memberB]]) {
    assert.strictEqual((await post(`/api/tables/${tableId}/start`,{memberId:member.id,couponCode:coupon.code})).status,200);
    const session=await sessionOf(tableId);
    const created=await body(await post(`/api/table-sessions/${session}/create-bill`,{paymentMethod:"cash"}));
    assert.strictEqual((await post(`/api/payments/${created.payment.id}/confirm`)).status,200);
  }

  report=await analytics();
  assert.strictEqual(report.couponRedemptions,2);
  assert.strictEqual(report.couponDiscount,40,"฿20 given away twice");
  assert.strictEqual(report.couponsUsed,1);
  assert.strictEqual(report.couponMembers,2);
  assert.strictEqual(report.topCoupons.length,1);
  assert.strictEqual(report.topCoupons[0].name,"ลดค่าโต๊ะ 20 บาท");
  assert.strictEqual(report.topCoupons[0].redemptions,2);
  assert.strictEqual(report.topCoupons[0].members,2);
  assert.strictEqual(report.topCoupons[0].discount,40);
  assert.deepStrictEqual(report.topCoupons[0].channels,{TABLE:2});
  assert.strictEqual(report.topCouponMembers.length,2);
  assert.ok(report.topCouponMembers.every(row=>row.discount===20&&row.redemptions===1));
  assert.ok(report.topCouponMembers.some(row=>row.memberCode==="RA001"),"the member identity comes off the bill snapshot");

  // A claim that has not been paid for is not a giveaway — it is counted separately, and live.
  assert.strictEqual((await post("/api/tables/3/start",{memberId:memberA.id,couponCode:coupon.code})).status,200);
  report=await analytics();
  assert.strictEqual(report.couponRedemptions,2,"a reservation is not a redemption");
  assert.strictEqual(report.couponDiscount,40);
  assert.strictEqual(report.outstandingCouponReservations,1);

  // Voiding a paid bill takes its discount back out of the report.
  const paidBill=(await body(await get("/api/bills?pageSize=50"))).items.find(bill=>bill.status==="paid"&&bill.couponDiscountSatang);
  assert.ok(paidBill,"a paid bill carrying a coupon");
  assert.strictEqual((await del(`/api/bills/${paidBill.id}`,{reason:"ทดสอบรายงาน"})).status,200);
  report=await analytics();
  assert.strictEqual(report.couponRedemptions,1,"a voided sale is no longer a redemption");
  assert.strictEqual(report.couponDiscount,20);
  assert.strictEqual(report.couponMembers,1);

  // A period with no coupon activity reports zero rather than yesterday's figures.
  const otherDay=await body(await get("/api/reports/analytics?type=day&period=2020-01-01"));
  assert.strictEqual(otherDay.couponDiscount,0);
  assert.strictEqual(otherDay.couponRedemptions,0);
  assert.strictEqual(otherDay.outstandingCouponReservations,1,"the outstanding count is live, not period-scoped");

  console.log("Sprint 11 coupon reporting tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
