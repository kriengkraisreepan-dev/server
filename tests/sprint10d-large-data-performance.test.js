const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

test("large isolated dataset stays within Sprint 10D response targets", { timeout: 30000 }, async t => {
  const root=path.resolve(__dirname,".."),dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"lucky-sprint10d-large-"));
  t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const createdAt="2026-07-01T10:00:00.000Z";
  const members=Array.from({length:5000},(_,i)=>({id:`M${i}`,memberCode:`MEM-${String(i).padStart(5,"0")}`,code:`MEM-${String(i).padStart(5,"0")}`,displayName:`Member ${i}`,name:`Member ${i}`,phone:`08${String(i).padStart(8,"0")}`,status:"ACTIVE",points:0,tier:"MEMBER",createdAt}));
  const products=Array.from({length:1000},(_,i)=>({id:`P${i}`,name:`Product ${i}`,price:10,priceSatang:1000,category:"General",active:true,status:"ACTIVE",trackStock:true,stockQuantity:100}));
  const bills=Array.from({length:10000},(_,i)=>({id:`B${i}`,number:`20260701-${String(i+1).padStart(6,"0")}`,receiptNumber:`20260701-${String(i+1).padStart(6,"0")}`,status:"paid",createdAt,total:100,totalSatang:10000,grossTotalSatang:10000,depositAppliedSatang:0,remainingPaymentSatang:10000,items:[]}));
  const store={settings:{shopName:"Benchmark",hourlyRate:100,minimumCharge:50,tableCount:3,promptPayId:""},tables:Array.from({length:3},(_,i)=>({id:i+1,code:`T0${i+1}`,name:`T${i+1}`,status:"free",items:[]})),members,products,bills,payments:[],auditLogs:Array.from({length:20000},(_,i)=>({id:`A${i}`,event:"BENCHMARK",occurredAt:createdAt}))};
  const reservations=Array.from({length:3000},(_,i)=>({id:`R${i}`,reservationNumber:`RSV-${i}`,customerName:`Customer ${i}`,phone:"0800000000",reservationDate:"2030-01-01",reservationTime:"10:00",reservedAt:"2030-01-01T03:00:00.000Z",effectiveReservationAt:"2030-01-01T03:00:00.000Z",status:"BOOKED",version:1,timeline:[]}));
  const deposits=Array.from({length:1000},(_,i)=>({id:`D${i}`,reservationId:`R${i}`,receiptNumber:`DR-${i}`,amountSatang:10000,status:"AVAILABLE",version:1}));
  fs.mkdirSync(dataDir,{recursive:true});fs.writeFileSync(path.join(dataDir,"store.json"),JSON.stringify(store));fs.writeFileSync(path.join(dataDir,"reservations.json"),JSON.stringify(reservations));fs.writeFileSync(path.join(dataDir,"reservation-deposits.json"),JSON.stringify(deposits));
  const port=39000+Math.floor(Math.random()*500),base=`http://127.0.0.1:${port}`,started=Date.now();
  const child=spawn(process.execPath,["index.js"],{cwd:root,env:{...process.env,PORT:String(port),LUCKY_DATA_DIR:dataDir},stdio:"ignore"});t.after(()=>child.kill());
  for(let i=0;i<100;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));if(i===99)throw new Error("benchmark server did not start");}
  const startupMs=Date.now()-started;
  let response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});assert.equal(response.status,200);const cookie=response.headers.get("set-cookie").split(";")[0];
  async function measure(url){const before=performance.now();const result=await fetch(`${base}${url}`,{headers:{Cookie:cookie}});await result.arrayBuffer();assert.equal(result.status,200,url);return Number((performance.now()-before).toFixed(2));}
  const results={startupMs,memoryRss:(await (await fetch(`${base}/api/health`,{headers:{Cookie:cookie}})).json()).memoryUsage.rss,billHistoryMs:await measure("/api/bills?page=1&pageSize=50"),memberSearchMs:await measure("/api/members/search?search=Member%204999&pageSize=20"),reservationListMs:await measure("/api/reservations"),reportMs:await measure("/api/reports/analytics?type=month&period=2026-07"),dashboardStateMs:await measure("/api/state")};
  assert.ok(results.billHistoryMs<500,JSON.stringify(results));assert.ok(results.memberSearchMs<500,JSON.stringify(results));assert.ok(results.reservationListMs<500,JSON.stringify(results));assert.ok(results.reportMs<1000,JSON.stringify(results));assert.ok(results.dashboardStateMs<1000,JSON.stringify(results));
  console.log("Sprint 10D large-data benchmark",results);
});
