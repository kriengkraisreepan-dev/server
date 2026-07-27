const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-pos-routes-")), port = 34000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const json = async response => { assert.match(response.headers.get("content-type") || "", /application\/json/); return response.json(); };
async function request(pathname, options = {}, cookie = "") { const response = await fetch(`${base}${pathname}`, { ...options, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) } }); return { response, body: await json(response) }; }
async function waitForServer(){for(let i=0;i<40;i+=1){try{const result=await fetch(`${base}/api/pos-orders`);if(result.status===401)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error("server did not start");}
(async()=>{try{
  await waitForServer(); let result=await request("/api/pos-orders"); assert.equal(result.response.status,401);
  result=await request("/api/auth/login",{method:"POST",body:JSON.stringify({username:"admin",password:"123456789"})}); const ownerCookie=result.response.headers.get("set-cookie").split(";")[0];
  result=await request("/api/pos-orders",{method:"POST",body:JSON.stringify({orderType:"WALK_IN"})},ownerCookie); assert.equal(result.response.status,201); const order=result.body.order;
  result=await request(`/api/pos-orders/${order.id}/items`,{method:"POST",body:JSON.stringify({productId:"p-water",quantity:2,unitPrice:1})},ownerCookie); assert.equal(result.response.status,200); assert.equal(result.body.order.total,30);
  result=await request(`/api/pos-orders/${order.id}`,{},ownerCookie); assert.equal(result.response.status,200); assert.equal(result.body.order.items[0].unitPrice,15);
  result=await request(`/api/pos-orders/${order.id}/confirm`,{method:"POST"},ownerCookie); assert.equal(result.response.status,200); assert.equal(result.body.order.status,"CONFIRMED");
  result=await request(`/api/pos-orders/${order.id}/confirm`,{method:"POST"},ownerCookie); assert.equal(result.response.status,409);
  result=await request("/api/unknown-pos-route",{},ownerCookie); assert.equal(result.response.status,404); assert.equal(result.body.error,"API route not found");
  console.log("Sprint 8B POS route regression tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
