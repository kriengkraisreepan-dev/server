const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");

test("Wizard UI is feature flagged, Thai, guarded, and cleans up",()=>{
  const js=fs.readFileSync(path.join(root,"public/js/app.js"),"utf8");
  assert.match(js,/hardwareWizardEnabled\(\)/);
  assert.match(js,/setupWizardEnabled!==false/);
  assert.match(js,/เริ่มตั้งค่ากล่องควบคุม/);
  assert.match(js,/ตั้งค่ากล่องควบคุมไฟโต๊ะ/);
  assert.match(js,/รายละเอียดทางเทคนิค/);
  assert.match(js,/ฉันตรวจสอบแล้วและสามารถทดสอบ Relay ได้อย่างปลอดภัย/);
  assert.match(js,/ปิด Relay ทั้งหมด/);
  assert.match(js,/cancelHardwareWizard/);
  assert.match(js,/method:"DELETE"/);
  assert.match(js,/type="password"/);
  assert.doesNotMatch(js,/localStorage[^;\n]*ApiKey/i);
});

test("backend exposes isolated wizard routes before final API 404",()=>{
  const source=fs.readFileSync(path.join(root,"index.js"),"utf8");
  const route=source.indexOf('app.post("/api/hardware/setup/start"');
  const final404=source.indexOf('app.use("/api", (req, res) => res.status(404)');
  assert.ok(route>0&&final404>route);
  for(const endpoint of ["/verify","/authenticate","/relays/:channel/test","/relays/all/off","/skip","/naming","/save"])assert.ok(source.includes(endpoint),endpoint);
});
