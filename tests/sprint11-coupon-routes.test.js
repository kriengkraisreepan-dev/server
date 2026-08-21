const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-coupon-")), port = 37000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(){for(let i=0;i<40;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)return;}catch{}await pause(100);}throw new Error("test server did not start");}
async function body(response){assert.match(response.headers.get("content-type")||"",/application\/json/);return response.json();}

(async()=>{try{
  await wait();
  let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});
  assert.strictEqual(response.status,200);
  const headers={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};
  const post=(url,payload)=>fetch(`${base}${url}`,{method:"POST",headers,body:JSON.stringify(payload)});
  const patch=(url,payload)=>fetch(`${base}${url}`,{method:"PATCH",headers,body:JSON.stringify(payload)});

  // A ฿50-off drinks coupon usable at the table AND at the counter — the shape the owner asked for.
  response=await post("/api/coupons",{name:"ส่วนลดเครื่องดื่ม 50 บาท",discountType:"FIXED",discountValue:5000,scope:"PRODUCTS",channels:["TABLE","WALK_IN"],status:"ACTIVE",totalQuota:10});
  assert.strictEqual(response.status,201,"OWNER can create a coupon");
  const coupon=(await body(response)).coupon;
  assert.match(coupon.code,/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/,"a code is generated from the no-confusables alphabet");
  assert.strictEqual(coupon.remainingQuota,10,"the list view carries the live quota");
  assert.strictEqual(coupon.summary.applied,0);

  response=await fetch(`${base}/api/coupons`,{headers});
  const list=(await body(response)).items;
  assert.strictEqual(list.length,1);
  assert.deepStrictEqual(list[0].channels,["TABLE","WALK_IN"]);

  // A table-charge coupon on a walk-in sale could only ever discount zero, so it is refused up front.
  response=await post("/api/coupons",{name:"ผิดกติกา",discountType:"FIXED",discountValue:5000,scope:"TABLE_CHARGE",channels:["TABLE","WALK_IN"]});
  assert.strictEqual(response.status,400);
  assert.strictEqual((await body(response)).error,"VALIDATION_ERROR");

  // A percent coupon with no ceiling is an open-ended liability on a long session.
  response=await post("/api/coupons",{name:"ไม่มีเพดาน",discountType:"PERCENT",discountValue:20,scope:"WHOLE_BILL"});
  assert.strictEqual(response.status,400);

  // Members only, enforced by the service and not just by the dialog.
  response=await post("/api/coupons/validate",{code:coupon.code});
  assert.strictEqual(response.status,400);
  assert.strictEqual((await body(response)).error,"COUPON_MEMBER_REQUIRED");

  response=await post("/api/members",{displayName:"ทดสอบ คูปอง",memberCode:"MC001"});
  assert.strictEqual(response.status,201);
  const member=(await body(response)).member;

  // Typed with a dash and in lower case, the way it comes off a paper voucher.
  response=await post("/api/coupons/validate",{code:coupon.code.toLowerCase().replace(/^(....)/,"$1-"),memberId:member.id,channel:"WALK_IN",baseSatang:12000});
  assert.strictEqual(response.status,200);
  const validated=await body(response);
  assert.strictEqual(validated.valid,true);
  assert.strictEqual(validated.discountSatang,5000,"the exact discount is resolved when the caller knows the sale total");
  assert.strictEqual(validated.rule.name,"ส่วนลดเครื่องดื่ม 50 บาท");

  // The same coupon, restricted to the table, must refuse the counter.
  response=await patch(`/api/coupons/${coupon.id}`,{channels:["TABLE"]});
  assert.strictEqual(response.status,200);
  response=await post("/api/coupons/validate",{code:coupon.code,memberId:member.id,channel:"WALK_IN"});
  assert.strictEqual(response.status,400);
  assert.strictEqual((await body(response)).error,"COUPON_CHANNEL_NOT_ALLOWED");

  // Pausing takes it out of use without deleting anything.
  response=await patch(`/api/coupons/${coupon.id}/status`,{status:"PAUSED"});
  assert.strictEqual(response.status,200);
  response=await post("/api/coupons/validate",{code:coupon.code,memberId:member.id});
  assert.strictEqual((await body(response)).error,"COUPON_NOT_ACTIVE");
  assert.strictEqual((await patch(`/api/coupons/${coupon.id}/status`,{status:"ACTIVE"})).status,200);

  // Voucher batches belong to unique-code coupons only.
  response=await post(`/api/coupons/${coupon.id}/codes`,{count:5});
  assert.strictEqual(response.status,400);

  response=await post("/api/coupons",{name:"บัตรกำนัล 100 บาท",codeMode:"UNIQUE",codeCount:3,discountType:"FIXED",discountValue:10000,scope:"WHOLE_BILL",channels:["TABLE"],status:"ACTIVE"});
  assert.strictEqual(response.status,201);
  const voucherCoupon=(await body(response)).coupon;
  assert.strictEqual(voucherCoupon.code,null,"a unique-code coupon has no shared code to leak");
  assert.strictEqual(voucherCoupon.remainingQuota,3);

  response=await fetch(`${base}/api/coupons/${voucherCoupon.id}/codes`,{headers});
  const codes=(await body(response)).items;
  assert.strictEqual(codes.length,3);
  assert.strictEqual(new Set(codes.map(entry=>entry.code)).size,3,"every printed voucher is different");
  assert.ok(codes.every(entry=>entry.status==="UNUSED"));

  response=await post(`/api/coupons/${voucherCoupon.id}/codes`,{count:2});
  assert.strictEqual(response.status,201);
  assert.strictEqual((await body(response)).coupon.remainingQuota,5,"a reprint adds vouchers, it does not replace them");

  response=await fetch(`${base}/api/coupons/${voucherCoupon.id}/redemptions`,{headers});
  const usage=await body(response);
  assert.deepStrictEqual(usage.items,[]);
  assert.strictEqual(usage.summary.applied,0);

  assert.strictEqual((await fetch(`${base}/api/coupons/does-not-exist/redemptions`,{headers})).status,404);
  response=await post("/api/coupons/validate",{code:"ZZZZZZZZ",memberId:member.id});
  assert.strictEqual(response.status,404);
  assert.strictEqual((await body(response)).error,"COUPON_CODE_NOT_FOUND");

  // A cashier may check a code at the counter, but may not manage the campaign.
  response=await post("/api/users",{username:"cashier1",password:"cashier12345",displayName:"แคชเชียร์",role:"CASHIER"});
  assert.strictEqual(response.status,201,"OWNER can create a cashier for the permission check");
  response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"cashier1",password:"cashier12345"})});
  assert.strictEqual(response.status,200);
  const cashier={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};
  assert.strictEqual((await fetch(`${base}/api/coupons`,{headers:cashier})).status,403,"a cashier does not manage coupons");
  assert.strictEqual((await fetch(`${base}/api/coupons`,{method:"POST",headers:cashier,body:JSON.stringify({name:"x",discountType:"FIXED",discountValue:100,scope:"PRODUCTS"})})).status,403);
  // …but validating must work for them: they are the ones typing the code in.
  response=await fetch(`${base}/api/coupons/validate`,{method:"POST",headers:cashier,body:JSON.stringify({code:coupon.code,memberId:member.id})});
  assert.strictEqual(response.status,200,"a cashier can check a coupon code");

  console.log("Sprint 11 coupon route tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
