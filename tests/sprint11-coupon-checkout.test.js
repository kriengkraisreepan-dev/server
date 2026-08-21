const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-coupon-checkout-")), port = 38000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(){for(let i=0;i<40;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)return;}catch{}await pause(100);}throw new Error("test server did not start");}
async function body(response){assert.match(response.headers.get("content-type")||"",/application\/json/);return response.json();}

(async()=>{try{
  await wait();
  let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});
  assert.strictEqual(response.status,200);
  const headers={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};
  const get=url=>fetch(`${base}${url}`,{headers});
  const post=(url,payload)=>fetch(`${base}${url}`,{method:"POST",headers,body:JSON.stringify(payload||{})});
  const del=(url,payload)=>fetch(`${base}${url}`,{method:"DELETE",headers,body:JSON.stringify(payload||{})});
  const sessionOf=async tableId=>((await body(await get("/api/state"))).tables.find(table=>String(table.id)===String(tableId))).runtimeSessionId;

  const member=(await body(await post("/api/members",{displayName:"คุณคูปอง",memberCode:"MC900"}))).member;

  // ---- a table-charge coupon, claimed at table open -----------------------------------------
  const tableCoupon=(await body(await post("/api/coupons",{name:"ลดค่าโต๊ะ 20 บาท",discountType:"FIXED",discountValue:2000,scope:"TABLE_CHARGE",channels:["TABLE"],status:"ACTIVE",totalQuota:1,perMemberLimit:0}))).coupon;

  response=await post("/api/tables/1/start",{memberId:member.id,couponCode:tableCoupon.code});
  assert.strictEqual(response.status,200,"the table opens with a coupon attached");
  assert.strictEqual((await body(response)).coupon.status,"RESERVED","the quota is held from the moment the table opens");

  // The quota is gone even though nothing has been paid — this is the race the design exists for.
  response=await post("/api/tables/2/start",{memberId:member.id,couponCode:tableCoupon.code});
  assert.strictEqual(response.status,400);
  assert.strictEqual((await body(response)).error,"COUPON_DEPLETED");
  const state=await body(await get("/api/state"));
  assert.strictEqual(state.tables.find(table=>String(table.id)==="2").status,"free","a refused coupon must not leave a half-open table behind");

  const session1=await sessionOf(1);
  const preview=(await body(await get(`/api/table-sessions/${session1}/billing-preview`))).preview;
  assert.strictEqual(preview.coupon.discountSatang,2000,"the checkout preview resolves the coupon before anything is committed");
  assert.strictEqual(preview.netTotalSatang,preview.breakdown.totalSatang-2000);

  // Points and coupons refuse each other, and the refusal must not close the session.
  response=await post(`/api/table-sessions/${session1}/create-bill`,{paymentMethod:"cash",memberId:member.id,redeemedPoints:100});
  assert.strictEqual(response.status,409);
  assert.strictEqual((await body(response)).error,"COUPON_POINTS_CONFLICT");
  assert.strictEqual((await body(await get("/api/state"))).tables.find(table=>String(table.id)==="1").status,"playing","the table is still open after the refusal");

  response=await post(`/api/table-sessions/${session1}/create-bill`,{paymentMethod:"cash"});
  assert.strictEqual(response.status,200);
  const checkout=await body(response),bill=checkout.bill;
  assert.strictEqual(bill.couponDiscountSatang,2000);
  assert.strictEqual(bill.couponCode,tableCoupon.code);
  assert.strictEqual(bill.couponName,"ลดค่าโต๊ะ 20 บาท");
  assert.strictEqual(bill.tableChargeSatang+bill.foodAmountSatang,bill.totalSatang,"the parts still add up to the total");
  assert.strictEqual(bill.playAmountSatang,bill.tableChargeSatang);
  assert.strictEqual(Number(bill.discount),20,"the coupon is part of what the bill reports as given away");
  assert.strictEqual(checkout.payment.amountSatang??Math.round(checkout.payment.amount*100),bill.totalSatang,"the customer is asked for the discounted total");

  assert.strictEqual((await post(`/api/payments/${checkout.payment.id}/confirm`)).status,200);
  let usage=await body(await get(`/api/coupons/${tableCoupon.id}/redemptions`));
  assert.strictEqual(usage.summary.applied,1);
  assert.strictEqual(usage.summary.discountSatang,2000);
  assert.strictEqual((await body(await get("/api/coupons"))).items.find(item=>item.id===tableCoupon.id).remainingQuota,0);

  // ---- voiding the sale hands the coupon back ------------------------------------------------
  response=await del(`/api/bills/${bill.id}`,{reason:"ทดสอบคืนคูปอง"});
  assert.strictEqual(response.status,200);
  usage=await body(await get(`/api/coupons/${tableCoupon.id}/redemptions`));
  assert.strictEqual(usage.summary.applied,0);
  assert.strictEqual(usage.summary.released,1);
  assert.strictEqual(usage.items[0].releaseReason,"BILL_VOIDED");

  // ---- taking the coupon off at the counter --------------------------------------------------
  assert.strictEqual((await post("/api/tables/2/start",{memberId:member.id,couponCode:tableCoupon.code})).status,200,"the returned quota can be claimed again");
  const session2=await sessionOf(2);
  assert.ok((await body(await get(`/api/table-sessions/${session2}/billing-preview`))).preview.coupon);
  assert.strictEqual((await del(`/api/table-sessions/${session2}/coupon`)).status,200);
  assert.strictEqual((await body(await get(`/api/table-sessions/${session2}/billing-preview`))).preview.coupon,null,"the coupon is gone from the checkout");
  // With the coupon off, points become available again on the same sale.
  response=await post(`/api/table-sessions/${session2}/create-bill`,{paymentMethod:"cash",memberId:member.id,redeemedPoints:100});
  assert.notStrictEqual((await body(response)).error,"COUPON_POINTS_CONFLICT","removing the coupon must free the points path");

  // ---- cancelling the table returns the quota ------------------------------------------------
  assert.strictEqual((await post("/api/tables/3/start",{memberId:member.id,couponCode:tableCoupon.code})).status,200);
  assert.strictEqual((await post("/api/tables/3/cancel")).status,200);
  usage=await body(await get(`/api/coupons/${tableCoupon.id}/redemptions`));
  assert.ok(usage.items.some(item=>item.releaseReason==="SESSION_CANCELLED"),"cancelling the table releases the claim");
  assert.strictEqual(usage.summary.reserved,0);

  // ---- a coupon that misses its minimum spend must not block the sale -------------------------
  const strictCoupon=(await body(await post("/api/coupons",{name:"ลดเมื่อครบพัน",discountType:"FIXED",discountValue:2000,scope:"TABLE_CHARGE",channels:["TABLE"],status:"ACTIVE",minSpendSatang:100000,perMemberLimit:0}))).coupon;
  assert.strictEqual((await post("/api/tables/3/start",{memberId:member.id,couponCode:strictCoupon.code})).status,200);
  const session3=await sessionOf(3);
  const strictPreview=(await body(await get(`/api/table-sessions/${session3}/billing-preview`))).preview;
  assert.strictEqual(strictPreview.coupon.meetsMinSpend,false,"the counter is warned before the sale, not after");
  assert.strictEqual(strictPreview.coupon.discountSatang,0);
  response=await post(`/api/table-sessions/${session3}/create-bill`,{paymentMethod:"cash"});
  assert.strictEqual(response.status,200,"the sale goes through without the coupon rather than being blocked");
  const strictBill=(await body(response)).bill;
  assert.ok(!strictBill.couponDiscountSatang);
  usage=await body(await get(`/api/coupons/${strictCoupon.id}/redemptions`));
  assert.strictEqual(usage.items[0].status,"RELEASED");
  assert.strictEqual(usage.items[0].releaseReason,"MIN_SPEND_NOT_MET");

  // ---- a ฿50-off drinks coupon on a walk-in sale with no table --------------------------------
  const walkInCoupon=(await body(await post("/api/coupons",{name:"ส่วนลดเครื่องดื่ม 50 บาท",discountType:"FIXED",discountValue:5000,scope:"PRODUCTS",channels:["TABLE","WALK_IN"],status:"ACTIVE",perMemberLimit:0}))).coupon;
  const products=(await body(await get("/api/products?pageSize=5"))).items;
  assert.ok(products.length,"the seeded products are needed for a walk-in sale");
  const order=(await body(await post("/api/pos-orders",{orderType:"WALK_IN",memberId:member.id}))).order;
  await post(`/api/pos-orders/${order.id}/items`,{productId:products[0].id,quantity:3});
  assert.strictEqual((await post(`/api/pos-orders/${order.id}/confirm`)).status,200);
  const walkInPreview=await body(await get(`/api/pos-orders/${order.id}/billing-preview`));
  response=await post(`/api/pos-orders/${order.id}/create-bill`,{paymentMethod:"cash",couponCode:walkInCoupon.code});
  assert.strictEqual(response.status,200,"a walk-in sale can carry a coupon");
  const walkInBill=(await body(response)).bill;
  const expected=Math.min(5000,walkInPreview.totalSatang);
  assert.strictEqual(walkInBill.couponDiscountSatang,expected);
  assert.strictEqual(walkInBill.totalSatang,walkInPreview.totalSatang-expected);
  assert.strictEqual(walkInBill.foodAmountSatang,walkInBill.totalSatang,"a walk-in bill is all products, so the discount comes off there");

  // The same coupon restricted to the table must be refused at the counter, and the refusal must
  // not leave the order billed.
  response=await fetch(`${base}/api/coupons/${walkInCoupon.id}`,{method:"PATCH",headers,body:JSON.stringify({channels:["TABLE"]})});
  assert.strictEqual(response.status,200);
  const order2=(await body(await post("/api/pos-orders",{orderType:"WALK_IN",memberId:member.id}))).order;
  await post(`/api/pos-orders/${order2.id}/items`,{productId:products[0].id,quantity:1});
  await post(`/api/pos-orders/${order2.id}/confirm`);
  response=await post(`/api/pos-orders/${order2.id}/create-bill`,{paymentMethod:"cash",couponCode:walkInCoupon.code});
  assert.strictEqual(response.status,400);
  assert.strictEqual((await body(response)).error,"COUPON_CHANNEL_NOT_ALLOWED");
  const order2After=(await body(await get(`/api/pos-orders/${order2.id}`))).order;
  assert.strictEqual(order2After.billingStatus,"UNBILLED","a refused coupon must not bill the order");

  console.log("Sprint 11 coupon checkout tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
