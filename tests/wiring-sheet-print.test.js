const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

// Manual Windows Acceptance found that "พิมพ์แผนผังสาย" printed a blank page. The old
// implementation called window.print() on the whole SPA and relied on a
// visibility:hidden/visible CSS trick to isolate #wiringSheet -- but the modal backdrop is
// position:fixed, and that combination is unreliable across browsers for print pagination.
// printBill() already solves this correctly with a dedicated popup window; the wiring sheet
// print button should use the same proven pattern instead of the page-wide window.print().
test("Wiring Sheet prints through its own popup window, not window.print() on the live page", () => {
  const ui = read("public/js/app.js");
  assert.doesNotMatch(ui, /wiringPrint"\)\.onclick=\(\)=>window\.print\(\)/, "should not print the whole SPA via the fragile visibility-toggle trick");
  const fn = ui.match(/\$\("#wiringPrint"\)\.onclick=\(\)=>\{[\s\S]*?\};\$\("#wiringDone"\)/)[0];
  assert.match(fn, /window\.open\(/, "should open a dedicated print window, matching printBill()'s pattern");
  assert.match(fn, /popup\.document\.write\(/);
  assert.match(fn, /popup\.print\(\)/);
});

test("the dead visibility-toggle print CSS for #wiringSheet was removed", () => {
  const css = read("public/css/hotfix.css");
  assert.doesNotMatch(css, /@media print/, "no page relies on the visibility:hidden/#wiringSheet print trick anymore");
});

test("the printed wiring sheet still carries device identity, mapping and the safety warning, with no device credentials", () => {
  const ui = read("public/js/app.js");
  const fn = ui.match(/\$\("#wiringPrint"\)\.onclick=\(\)=>\{[\s\S]*?\};\$\("#wiringDone"\)/)[0];
  assert.match(fn, /Device ID: \$\{escapeHtml\(d\.deviceId\)\}/);
  assert.match(fn, /wiringRows\(profile\.mapping\)/);
  assert.match(fn, /\$\{tableRows\}/);
  assert.match(fn, /คำเตือน: ตัดไฟบ้านก่อนแก้สาย/);
  assert.doesNotMatch(fn, /apiKey|secretId|setupCode|sessionToken|deviceKey/i);
});
