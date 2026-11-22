// Settings → AI Bridge (Task A3). Talks only to Electron main through window.luckyDesktop.aiBridge
// (preload); main re-checks OWNER/MANAGER on every call. Nothing here reaches the POS API.
// Uses app.js globals ($, escapeHtml, notify, render, state, hourMinuteFieldHtml) at call time.
let aiBridgeStatus = null, aiBridgeError = null;
const AI_BRIDGE_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const AI_BRIDGE_STATES = { not_paired: "ยังไม่ได้เชื่อมต่อ", connecting: "กำลังเชื่อมต่อ…", online: "ออนไลน์", offline: "ออฟไลน์ (กำลังลองใหม่อัตโนมัติ — ร้านใช้งานได้ตามปกติ)", stopped: "หยุดอยู่", revoked: "ถูกยกเลิกจาก Cloud — เชื่อมต่อใหม่ด้วย pairing code" };

function aiBridgeAvailable() { return Boolean(window.luckyDesktop?.aiBridge); }
function aiBridgeAllowed() { return ["OWNER", "MANAGER"].includes(state?.user?.role); }

async function loadAiBridgeStatus() {
  if (!aiBridgeAvailable()) return;
  try { aiBridgeStatus = await window.luckyDesktop.aiBridge.status(); aiBridgeError = null; }
  catch (error) { aiBridgeError = aiBridgeMessage(error); }
}
// Electron prefixes IPC errors with "Error invoking remote method …: Error: "; keep only our text.
function aiBridgeMessage(error) { return String(error?.message || error || "").replace(/^Error invoking remote method '[^']+': (Error: )?/, ""); }

function aiBridgePanel() {
  if (!aiBridgeAvailable()) return `<div class="card"><h3>AI Bridge</h3><p class="muted">ใช้ได้เฉพาะในโปรแกรม 88 Snooker Manager บนเครื่องร้าน (Windows)</p></div>`;
  const s = aiBridgeStatus;
  if (!s) return `<div class="card"><h3>AI Bridge</h3><p class="muted">${aiBridgeError ? escapeHtml(aiBridgeError) : "กำลังโหลด…"}</p><button type="button" id="aiBridgeRefresh">รีเฟรชสถานะ</button></div>`;
  const hours = s.shopInfo?.weeklyHours || Array(7).fill(null);
  const kinds = s.tableKinds || {};
  const statusCard = `<div class="card"><h3>AI Bridge — สถานะ</h3>
    <p>สถานะ: <b>${escapeHtml(AI_BRIDGE_STATES[s.state] || s.state)}</b></p>
    ${s.paired ? `<p class="muted">เครื่อง: ${escapeHtml(s.deviceName)} · Cloud: ${escapeHtml(s.hubBaseUrl)}</p>` : ""}
    <p class="muted">ส่ง snapshot ล่าสุด: ${s.lastSnapshotAt ? escapeHtml(new Date(s.lastSnapshotAt).toLocaleString("th-TH")) : "-"} · รอส่ง: ${Number(s.pendingOutbox || 0)}</p>
    ${s.lastError ? `<p class="wizard-status warning">ล่าสุด: ${escapeHtml(s.lastError)}</p>` : ""}
    ${s.safeStorageAvailable ? "" : `<p class="wizard-status warning">เครื่องนี้เข้ารหัส token ไม่ได้ (safeStorage) จึงเชื่อมต่อไม่ได้</p>`}
    <p class="muted">ส่งขึ้น Cloud เฉพาะ: สถานะโต๊ะ เวลาที่เล่น จำนวนคิว ราคา เวลาเปิด-ปิด — ไม่มีชื่อ/เบอร์ลูกค้า ยอดบิล หรือข้อมูลพนักงาน</p>
    <button type="button" id="aiBridgeRefresh">รีเฟรชสถานะ</button>
    ${s.paired ? ` <button type="button" class="danger" id="aiBridgeDisconnect">ตัดการเชื่อมต่อ (ลบ token ในเครื่อง)</button>` : ""}</div>`;
  const pairCard = s.paired ? "" : `<div class="card form" style="margin-top:18px"><h3>เชื่อมต่อกับ Cloud</h3>
    ${s.shopInfo ? "" : `<p class="wizard-status warning">ตั้งเวลาเปิด-ปิดร้านด้านล่างก่อน จึงจะเชื่อมต่อได้</p>`}
    <form id="aiBridgePairForm">
      <label>ที่อยู่ Cloud hub<input name="hubBaseUrl" required placeholder="https://..." value="${escapeHtml(s.hubBaseUrl || "")}"></label>
      <label>Pairing code (จาก Admin web → เพิ่มเครื่องร้าน)<input name="pairingCode" required maxlength="8" autocomplete="off" style="text-transform:uppercase"></label>
      <label>ชื่อเครื่อง<input name="deviceName" required maxlength="60" value="Front desk PC"></label>
      <button ${s.shopInfo && s.safeStorageAvailable ? "" : "disabled"}>เชื่อมต่อ</button>
    </form></div>`;
  const dayRows = AI_BRIDGE_DAYS.map((label, day) => {
    const h = hours[day];
    return `<div class="two" data-ai-day="${day}"><label><input type="checkbox" class="ai-day-closed" ${h ? "" : "checked"}> ${label} ปิด</label>
      <div class="two"><div>เปิด ${hourMinuteFieldHtml({ hiddenAttributes: 'class="ai-day-open"', value: h?.open || "12:00" })}</div><div>ปิด ${hourMinuteFieldHtml({ hiddenAttributes: 'class="ai-day-close"', value: h?.close || "02:00" })}</div></div></div>`;
  }).join("");
  const tableRows = (state.tables || []).map(table => `<label>${escapeHtml(table.name)} <select data-ai-table-kind="${escapeHtml(String(table.id))}"><option value="snooker" ${kinds[table.id] === "pool" ? "" : "selected"}>สนุกเกอร์</option><option value="pool" ${kinds[table.id] === "pool" ? "selected" : ""}>พูล</option></select></label>`).join("");
  const infoCard = `<div class="card form" style="margin-top:18px"><h3>ข้อมูลร้านสำหรับผู้ช่วย AI</h3>
    <form id="aiBridgeShopForm">
      <p class="muted">เวลาเปิด-ปิด (เวลาไทย) ถ้าเวลาปิดน้อยกว่าเวลาเปิด = ปิดหลังเที่ยงคืน</p>${dayRows}
      <label>ประกาศวันนี้ (ไม่เกิน 200 ตัวอักษร)<textarea name="note" maxlength="200">${escapeHtml(s.shopInfo?.note || "")}</textarea></label>
      <h4>ประเภทโต๊ะ</h4>${tableRows || `<p class="muted">ยังไม่มีโต๊ะ</p>`}
      <button>บันทึก</button>
    </form></div>`;
  return statusCard + pairCard + infoCard;
}

function aiBridgeReadShopForm(form) {
  const weeklyHours = [...form.querySelectorAll("[data-ai-day]")].sort((a, b) => a.dataset.aiDay - b.dataset.aiDay).map(row => {
    if (row.querySelector(".ai-day-closed").checked) return null;
    return { open: row.querySelector(".ai-day-open").value, close: row.querySelector(".ai-day-close").value };
  });
  const note = form.querySelector('[name="note"]').value.trim();
  const tableKinds = {};
  form.querySelectorAll("[data-ai-table-kind]").forEach(select => { if (select.value === "pool") tableKinds[select.dataset.aiTableKind] = "pool"; });
  return { shopInfo: note ? { weeklyHours, note } : { weeklyHours }, tableKinds };
}

async function aiBridgeRun(action, okText) {
  try { aiBridgeStatus = await action(); aiBridgeError = null; if (okText) notify(okText); }
  catch (error) { notify(aiBridgeMessage(error), true); await loadAiBridgeStatus(); }
  render();
}

function bindAiBridgePanel() {
  if (!$("#aiBridgeRefresh")) return;
  $("#aiBridgeRefresh").onclick = async () => { await loadAiBridgeStatus(); render(); };
  $("#aiBridgeDisconnect") && ($("#aiBridgeDisconnect").onclick = () => {
    if (!confirm("ตัดการเชื่อมต่อ AI Bridge?\ntoken ในเครื่องจะถูกลบ ต้องใช้ pairing code ใหม่เพื่อเชื่อมต่ออีกครั้ง")) return;
    aiBridgeRun(() => window.luckyDesktop.aiBridge.disconnect(), "ตัดการเชื่อมต่อแล้ว");
  });
  $("#aiBridgePairForm") && ($("#aiBridgePairForm").onsubmit = event => {
    event.preventDefault();
    const d = Object.fromEntries(new FormData(event.target));
    aiBridgeRun(() => window.luckyDesktop.aiBridge.pair({ hubBaseUrl: d.hubBaseUrl, pairingCode: String(d.pairingCode || "").toUpperCase(), deviceName: d.deviceName }), "เชื่อมต่อแล้ว");
  });
  $("#aiBridgeShopForm") && ($("#aiBridgeShopForm").onsubmit = event => {
    event.preventDefault();
    aiBridgeRun(() => window.luckyDesktop.aiBridge.saveShopInfo(aiBridgeReadShopForm(event.target)), "บันทึกข้อมูลร้านแล้ว");
  });
}

// Hook into app.js's bind() chain (same pattern app.js uses for its own panels).
if (typeof bind === "function") { const bindBeforeAiBridge = bind; bind = function () { bindBeforeAiBridge(); bindAiBridgePanel(); }; }
