// Phase 5.5 Revision 2: authentication credentials stay in the trusted backend.
const renderHardwareWizardWithoutCredential = renderHardwareWizard;
renderHardwareWizard = function () {
  renderHardwareWizardWithoutCredential();
  if (hardwareWizard?.stepNumber !== 4) return;
  const secret = document.querySelector(".wizard-secret");
  if (secret) {
    const label = secret.previousElementSibling;
    if (label?.tagName === "LABEL") label.remove();
    secret.nextElementSibling?.remove();
    secret.remove();
  }
  const confirmation = document.querySelector("#wizardDeviceAccessConfirm");
  if (confirmation) confirmation.closest("label").innerHTML = '<input id="wizardDeviceAccessConfirm" type="checkbox"> ยืนยันให้ Backend ตรวจสอบอุปกรณ์อย่างปลอดภัย';
  const button = document.querySelector("#wizardAuthenticate");
  if (button) button.textContent = "ยืนยันอุปกรณ์อย่างปลอดภัย";
};

const bindHardwareWizardWithoutCredential = bindHardwareWizardStep;
bindHardwareWizardStep = function () {
  bindHardwareWizardWithoutCredential();
  const button = document.querySelector("#wizardAuthenticate");
  if (!button) return;
  button.onclick = async () => {
    if (hardwareWizardBusy) return;
    const confirmedDeviceAccess = Boolean(document.querySelector("#wizardDeviceAccessConfirm")?.checked);
    const confirmedLegacyMigration = !hardwareWizard.legacyMigration || Boolean(document.querySelector("#wizardLegacyMigrationConfirm")?.checked);
    if (!confirmedDeviceAccess) return wizardError(Error("กรุณายืนยันให้ระบบตรวจสอบอุปกรณ์อย่างปลอดภัย"));
    hardwareWizardBusy = true; button.disabled = true;
    try {
      hardwareWizard = await api(`/api/hardware/setup/${hardwareWizard.id}/authenticate`, { method: "POST", body: JSON.stringify({ confirmedDeviceAccess, confirmedLegacyMigration }) });
      hardwareWizard.stepNumber = 5; renderHardwareWizard();
    } catch (error) {
      if (error.code === "USB_REAUTHENTICATION_REQUIRED") renderUsbAdoptionRequired();
      else wizardError(error);
      button.disabled = false;
    }
    finally { hardwareWizardBusy = false; }
  };
};

function renderUsbAdoptionRequired() {
  const target = document.querySelector("#wizardError");
  if (!target) return;
  target.innerHTML = '<b>ยังไม่มีข้อมูลยืนยันกล่องนี้ในเครื่องคอมพิวเตอร์</b><br><small>กรุณาเชื่อมต่อ USB เพื่อเพิ่มกล่องอย่างปลอดภัย</small><br><button type="button" id="wizardUsbAdopt">เพิ่มกล่องนี้ผ่าน USB</button>';
  document.querySelector("#wizardUsbAdopt").onclick = openUsbAdoptionDialog;
}

async function openUsbAdoptionDialog() {
  try {
    const result = await api("/api/hardware/usb-flasher/ports");
    const ports = result.ports || [];
    if (!ports.length) throw Error("ไม่พบ COM Port กรุณาเชื่อมต่อสาย USB แล้วลองใหม่");
    document.querySelector("#modalBody").innerHTML = `<h3>เพิ่มกล่องเดิมผ่าน USB</h3>
      <label>COM Port</label><select id="usbAdoptPort">${ports.map(item => `<option value="${escapeHtml(item.port)}">${escapeHtml(item.port)}</option>`).join("")}</select>
      <label>ชื่อกล่องที่ใช้ในโปรแกรม</label><input id="usbAdoptName" maxlength="80" value="กล่องควบคุมโต๊ะ">
      <label>ตำแหน่ง (ไม่บังคับ)</label><input id="usbAdoptLocation" maxlength="120">
      <label>Setup Code</label><input id="usbAdoptCode" type="password" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX">
      <label class="checkbox-line"><input id="usbAdoptSafe" type="checkbox"> ยืนยันว่าถอดโหลดไฟบ้านและ Relay ทุกช่อง OFF</label>
      <div id="wizardError" class="wizard-error"></div><button class="outline" id="usbAdoptBack">ย้อนกลับ</button> <button id="usbAdoptStart">ตรวจสอบและเพิ่มกล่อง</button>`;
    document.querySelector("#usbAdoptBack").onclick = () => { hardwareWizard.stepNumber = 4; renderHardwareWizard(); renderUsbAdoptionRequired(); };
    document.querySelector("#usbAdoptStart").onclick = startUsbAdoption;
  } catch (error) { wizardError(error); }
}

async function startUsbAdoption() {
  const button = document.querySelector("#usbAdoptStart"), code = document.querySelector("#usbAdoptCode");
  const port = document.querySelector("#usbAdoptPort").value, setupCode = code.value.toUpperCase(), deviceName = document.querySelector("#usbAdoptName").value.trim(), location = document.querySelector("#usbAdoptLocation").value.trim(), confirmedSafe = document.querySelector("#usbAdoptSafe").checked;
  if (!deviceName || !confirmedSafe) return wizardError(Error("กรุณาระบุชื่อกล่องและยืนยันความปลอดภัย"));
  button.disabled = true;
  try {
    const issued = await api(`/api/hardware/setup/${hardwareWizard.id}/usb-adoption/token`, { method: "POST", body: JSON.stringify({ port }) });
    code.value = "";
    const operation = await api(`/api/hardware/setup/${hardwareWizard.id}/usb-adoption/start`, { method: "POST", body: JSON.stringify({ adoptionToken: issued.adoptionToken, port, setupCode, deviceName, location, confirmedSafe }) });
    if (operation.state === "COMPLETED") { hardwareWizard.stepNumber = 5; renderHardwareWizard(); notify("เพิ่มกล่องผ่าน USB สำเร็จ"); return; }
    if (operation.state === "VAULT_RECOVERY_REQUIRED") {
      const target = document.querySelector("#wizardError");
      target.innerHTML = '<b>Firmware เปลี่ยนรหัสแล้ว แต่ยังบันทึก vault ไม่สำเร็จ</b><br><small>ห้ามปิดโปรแกรมหรือถอด USB</small><br><button type="button" id="usbAdoptRetry">Retry บันทึก vault</button>';
      document.querySelector("#usbAdoptRetry").onclick = () => retryUsbAdoption(operation.id);
      return;
    }
    throw Error(operation.message || "เพิ่มกล่องผ่าน USB ไม่สำเร็จ");
  } catch (error) { wizardError(error); button.disabled = false; }
}

async function retryUsbAdoption(operationId) {
  const button = document.querySelector("#usbAdoptRetry"); if (button) button.disabled = true;
  try {
    const operation = await api(`/api/hardware/usb-adoption/${operationId}/retry`, { method: "POST", body: "{}" });
    if (operation.state !== "COMPLETED") throw Error(operation.message || "ยังบันทึก vault ไม่สำเร็จ ห้ามปิดโปรแกรมหรือถอด USB");
    hardwareWizard.stepNumber = 5; renderHardwareWizard(); notify("เพิ่มกล่องผ่าน USB สำเร็จ");
  } catch (error) { wizardError(error); if (button) button.disabled = false; }
}
