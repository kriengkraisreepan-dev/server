const test = require("node:test");
const assert = require("node:assert/strict");
const { WindowsComPortProvider } = require("../drivers/windows-com-port-provider");

test("COM provider accepts enriched port objects when available", () => {
  const provider = new WindowsComPortProvider({ execFile: () => JSON.stringify({ port:"COM3", name:"CP210x (COM3)", manufacturer:"Silicon Labs", vid:"10C4", pid:"EA60", serialNumber:null }) });
  assert.equal(provider.list()[0].vid, "10C4");
});

test("COM provider uses its secondary discovery path when direct enumeration fails", () => {
  let calls = 0;
  const provider = new WindowsComPortProvider({ execFile: () => {
    calls += 1;
    if (calls === 1) throw new Error("Access denied");
    return JSON.stringify("COM3");
  } });
  assert.deepEqual(provider.list(), [{ port:"COM3", name:"COM3", manufacturer:null, vid:null, pid:null, serialNumber:null }]);
});

test("COM provider returns an empty list only when both discovery paths fail", () => {
  const provider = new WindowsComPortProvider({ execFile: () => { throw new Error("blocked"); } });
  assert.deepEqual(provider.list(), []);
});
