# Phase 6A Manual Acceptance Defect 02 — Resolution

Defect A: หลังใช้ปุ่ม "เปลี่ยนกล่องควบคุม" (หรือย้ายผลลัพธ์ USB Adoption ด้วยมือ) กล่องเก่าที่ถูกเก็บเป็น `REPLACED_ARCHIVED` ยังแสดงเป็นการ์ดเต็มรูปแบบซ้ำกับกล่องใหม่ทุกประการ (ชื่อ, Device ID, IP ตรงกัน) เพราะ Hardware Manager ไม่กรองสถานะนี้เลย และยังเลือกเป็นเป้าหมายผูกโต๊ะได้ ที่ร้ายกว่านั้นคือ background health poller ก็ไม่ข้ามกล่องที่ถูกเปลี่ยนแทนแล้วเช่นกัน — health check ยังผ่านได้ปกติ (ไม่ต้องใช้ API Key ถูกต้อง) จึงเซ็ตสถานะกลับเป็น `ONLINE` ทับสถานะ `REPLACED_ARCHIVED` ทุกรอบ poll (~15 วินาที)

Defect B: ปุ่ม "พิมพ์แผนผังสาย" พิมพ์ออกมาว่างเปล่า เพราะเรียก `window.print()` บนหน้าเว็บทั้งหน้า พึ่งพา CSS `body *{visibility:hidden}` / `#wiringSheet{visibility:visible}` เพื่อแยกเฉพาะส่วน แต่ modal ใช้ `position:fixed` ซึ่งเข้ากันไม่ได้กับเทคนิคนี้อย่างน่าเชื่อถือในการแบ่งหน้าพิมพ์ข้ามเบราว์เซอร์

Resolution A: `HardwareHealthMonitoringService.check()` ข้ามอุปกรณ์ที่ `status === "REPLACED_ARCHIVED"` เพิ่มเติมจากเงื่อนไขเดิม Hardware Manager กรองกล่องที่เปลี่ยนแทนแล้วออกจากการ์ดหลักและตัวเลือกผูกโต๊ะ (โต๊ะที่ยังผูกกับกล่องเก่าอยู่จะยังเห็นตัวเลือกนั้นพร้อมป้าย "(เปลี่ยนแทนแล้ว)" แทนที่จะหายไปเงียบๆ) และเพิ่มตารางประวัติ "อุปกรณ์ที่เปลี่ยนแทนแล้ว" แบบอ่านอย่างเดียวไว้ท้ายหน้า

Resolution B: เปลี่ยนปุ่มพิมพ์ให้เปิดหน้าต่างพิมพ์แยก (`window.open` + เขียน HTML ของตัวเอง + `popup.print()`) แบบเดียวกับใบเสร็จ (`printBill`) ที่พิสูจน์แล้วว่าใช้งานได้จริง ลบ CSS `@media print` เดิมที่ไม่ใช้แล้วออก

เทสต์ที่เพิ่ม: `tests/hardware-manager-archived-devices-ui.test.js`, `tests/wiring-sheet-print.test.js`, เคสใหม่ใน `tests/phase5_4b-hardware-health-monitoring.test.js` (poller ไม่แตะกล่อง archived เลย) แก้ assertion เดิมใน `tests/phase5_2a-hardware-wiring-assistant.test.js` ที่ยึดพฤติกรรม `window.print()` เดิมไว้ รวม `node --test tests/*.test.js` ผ่านครบ 290/290 (ไม่มี regression)

ตรวจซ้ำจริง: พบทั้งสองปัญหานี้ระหว่างทดสอบ Manual Windows Acceptance บนอุปกรณ์จริงในเซสชันเดียวกับ [PHASE6A_MANUAL_DEFECT_01](PHASE6A_MANUAL_DEFECT_01_HARDWARE_SECRET_VAULT_MIGRATION.md) หลังแก้แล้วยืนยันซ้ำจริงว่า: เหลือการ์ดอุปกรณ์เดียวใน Hardware Manager, กล่องที่ถูกเปลี่ยนแทนแล้วไม่ถูกดึงกลับมาเป็น ONLINE แม้รอผ่าน poll cycle, และพิมพ์ Wiring Sheet ได้ข้อมูลครบ (Device ID, Relay mapping, วันที่ตรวจ, ผู้ตรวจ) ไม่มี Device Key/Setup Code/Wi-Fi password/session token หลุดออกมา

สิ่งที่ไม่เปลี่ยน: schema ของ `replaceController()`/`REPLACED_ARCHIVED`, เนื้อหาที่แสดงบน Wiring Sheet (เปลี่ยนแค่กลไกการพิมพ์)
