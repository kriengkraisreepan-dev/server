const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

// Manual Windows/Hardware Acceptance found that replacing a controller (replaceController(),
// status REPLACED_ARCHIVED) left the old record rendered as a full, indistinguishable
// "ONLINE"-looking card forever, because nothing in the UI filtered by status. Staff could not
// tell which of two identical-looking "Lucky Relay 01" cards was the real, working one, and
// the archived device was still selectable as a table's relay mapping target.
test("Hardware Manager grid and table-mapping dropdown exclude REPLACED_ARCHIVED devices", () => {
  const ui = read("public/js/app.js");
  const fn = ui.match(/function hardware\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(fn, /const liveDevices=hardwareDevices\.filter\(device=>device\.status!=="REPLACED_ARCHIVED"\)/, "should compute a live (non-archived) device list");
  assert.match(fn, /const archivedDevices=hardwareDevices\.filter\(device=>device\.status==="REPLACED_ARCHIVED"\)/, "should compute an archived device list");
  assert.match(fn, /const cards=liveDevices\.map\(/, "the main card grid must render liveDevices, not the raw list");
  assert.match(fn, /const options=liveDevices\.map\(/, "the table relay-mapping dropdown must offer liveDevices, not the raw list");
});

test("a table already mapped to an archived device still shows that device labelled, instead of silently going blank", () => {
  const ui = read("public/js/app.js");
  assert.match(ui, /archivedCurrent\?`<option value="\$\{archivedCurrent\.id\}" selected>\$\{escapeHtml\(archivedCurrent\.deviceName\)\} \(เปลี่ยนแทนแล้ว\)<\/option>`:""/);
});

test("archived devices are still listed read-only for audit, with a friendly status badge", () => {
  const ui = read("public/js/app.js");
  assert.match(ui, /REPLACED_ARCHIVED:"🗄 เปลี่ยนแทนแล้ว"/, "hardwareBadge should label REPLACED_ARCHIVED instead of falling back to an unknown-status message");
  assert.match(ui, /const archivedSection=archivedDevices\.length\?/, "should render a read-only archived-devices section when any exist");
});
