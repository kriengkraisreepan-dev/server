const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { spawn } = require("child_process");
const root = path.resolve(__dirname, ".."), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucky-publicstatus-")), port = 37000 + Math.floor(Math.random() * 1000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["index.js"], { cwd: root, env: { ...process.env, PORT: String(port), LUCKY_DATA_DIR: dataDir }, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(){for(let i=0;i<40;i+=1){try{if((await fetch(`${base}/api/state`)).status===401)return;}catch{}await pause(100);}throw new Error("test server did not start");}
async function body(response){assert.match(response.headers.get("content-type")||"",/application\/json/);return response.json();}

// The public table-status endpoint exists specifically so anonymous customers can check table
// availability from their own phone — it must work with NO login, and must never leak anything
// beyond id/name/status/elapsedSeconds (no price, no member identity, no revenue).
(async()=>{try{
  await wait();

  // No Cookie header at all — this must still succeed, unlike every other /api route.
  let response=await fetch(`${base}/api/public/tables`);
  assert.strictEqual(response.status,200,"the public status route must not require authentication");
  let data=await body(response);
  assert.ok(Array.isArray(data.items) && data.items.length>0, "must list at least the seeded tables");
  for (const table of data.items) {
    assert.deepStrictEqual(Object.keys(table).sort(), ["elapsedSeconds","id","name","status"], "the public payload must expose exactly these 4 fields and nothing more sensitive");
  }
  assert.ok(data.items.every(table=>table.status==="free"), "no table has been started yet, all must read as free");
  assert.ok(data.items.every(table=>table.elapsedSeconds===0), "a free table must report zero elapsed time");

  // Log in as staff and start table 1 to prove the public view reflects real state without needing auth itself.
  response=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"123456789"})});
  assert.strictEqual(response.status,200);
  const headers={Cookie:response.headers.get("set-cookie").split(";")[0],"Content-Type":"application/json"};
  response=await fetch(`${base}/api/tables/1/start`,{method:"POST",headers,body:"{}"});
  assert.strictEqual(response.status,200);

  // Re-fetch the PUBLIC route again with no auth at all — it must now show table 1 as playing.
  response=await fetch(`${base}/api/public/tables`);
  assert.strictEqual(response.status,200);
  data=await body(response);
  const table1=data.items.find(item=>String(item.id)==="1");
  assert.ok(table1,"table 1 must still be present");
  assert.strictEqual(table1.status,"playing","the public view must reflect the real, current table status");
  assert.deepStrictEqual(Object.keys(table1).sort(), ["elapsedSeconds","id","name","status"], "still only the 4 safe fields even for an active table with a real session behind it");

  console.log("Public table status route tests passed");
}finally{child.kill();fs.rmSync(dataDir,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
