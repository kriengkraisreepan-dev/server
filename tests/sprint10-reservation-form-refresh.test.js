const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { patchReservationLiveContent } = require("../public/js/reservation-refresh");

test("twelve polling updates over 60 seconds preserve the same dirty reservation form", () => {
  const form = {
    elements: {
      customerName: { value: "ลูกค้าที่กำลังพิมพ์" },
      phone: { value: "081234" },
      remark: { value: "ข้อความที่ยังพิมพ์ไม่เสร็จ" }
    }
  };
  const originalForm = form;
  const liveContent = { innerHTML: '<div class="card">รายการเดิม</div>' };
  const documentRef = {
    querySelector(selector) {
      if (selector === "#reservationForm") return form;
      if (selector === "#reservationLiveContent") return liveContent;
      return null;
    }
  };

  for (let poll = 1; poll <= 12; poll += 1) {
    const patched = patchReservationLiveContent(documentRef, `<div class="card">รายการอัปเดต ${poll}</div>`);
    assert.strictEqual(patched, true);
    assert.strictEqual(documentRef.querySelector("#reservationForm"), originalForm);
    assert.strictEqual(form.elements.customerName.value, "ลูกค้าที่กำลังพิมพ์");
    assert.strictEqual(form.elements.phone.value, "081234");
    assert.strictEqual(form.elements.remark.value, "ข้อความที่ยังพิมพ์ไม่เสร็จ");
  }

  assert.match(liveContent.innerHTML, /รายการอัปเดต 12/);
});

test("frontend wires dirty tracking, successful reset, and targeted live-content patching", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../public/js/app.js"), "utf8");
  assert.match(source, /reservationFormDirty\s*=\s*false/);
  assert.match(source, /form\.oninput=.*reservationFormDirty=true/);
  assert.match(source, /form\.onchange=.*reservationFormDirty=true/);
  assert.match(source, /form\.reset\(\);reservationFormDirty=false;await refresh\(\)/);
  assert.match(source, /patchReservationLiveContent\(document,reservationCardsHtml\(\)\)/);
  assert.match(source, /id="reservationLiveContent"/);
});
