const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

// Manual Windows Acceptance found that Bill History had no way to reprint a receipt from
// the UI, even though printBill() (used right after checkout) already renders the
// immutable stored bill data -- which always carries the original receipt number.
test("Bill History has a reprint button wired to the existing printBill receipt renderer", () => {
  const ui = read("public/js/app.js");
  assert.match(ui, /data-bill-reprint="\$\{b\.id\}"/, "bill row is missing the reprint button");
  assert.match(ui, /data-bill-reprint\]"\)\.forEach\(button=>button\.onclick=\(\)=>reprintBillFromHistory\(button\.dataset\.billReprint\)\)/, "reprint button is not wired in bind()");
  assert.match(ui, /function reprintBillFromHistory\(id\)/, "reprintBillFromHistory helper is missing");
});

test("reprinting merges a bill found only via Bill History search into state.bills before printing", () => {
  const ui = read("public/js/app.js");
  const fn = ui.match(/function reprintBillFromHistory\(id\)\{[^}]*\}/)[0];
  assert.match(fn, /billHistory\?\.items/, "should look up the bill from the loaded Bill History page");
  assert.match(fn, /state\.bills=\[\.\.\.state\.bills,bill\]/, "should merge the bill into state.bills so printBill(id) can find it");
  assert.match(fn, /printBill\(id\)/, "should delegate rendering to the existing printBill so the receipt number is unchanged");
});
