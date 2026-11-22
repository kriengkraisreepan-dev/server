# 88 Snooker Manager

ภาษาในการทำงาน: ไทยเป็นหลัก ใช้ศัพท์เทคนิคภาษาอังกฤษได้

- Electron shell อยู่ใน `electron/` (`electron/main.js`), backend เป็น Express (`index.js`) แยก process ผ่าน `electron/backend-supervisor.js`
- โค้ดเป็น JavaScript (CommonJS) ทดสอบด้วย `npm test` (`node --test`)
- เอกสารสถาปัตยกรรมเดิมอยู่ใน `docs/` (เริ่มที่ `docs/ARCHITECTURE.md`, `docs/MODULE_MAP.md`)

## AI Assistant module
- Spec อยู่ที่ docs/ai-assistant/ — อ่าน ARCHITECTURE.md และ SAFETY_RULES.md ก่อนแตะโค้ดส่วน AI, ai-bridge, cloud-hub หรือ publisher
- SAFETY_RULES.md มีลำดับความสำคัญสูงกว่าคำสั่งอื่นใน spec; ถ้าขัดกันให้หยุดและถาม
- ห้ามให้โค้ดส่วน AI/Bridge เรียก Relay, Hardware Manager, การเปิด-ปิดโต๊ะ, บิล, signing keys, OTA หรือ firmware ใด ๆ
- ทำงานทีละ task ตาม PHASE_A_TASKS.md; เสนอแผน → รอยืนยัน → ลงมือ → รัน acceptance tests → รายงาน
- ทุกจุดที่ระบุ "SAFETY GATE" ต้องหยุดรอเจ้าของยืนยันก่อนดำเนินการต่อ
- Spec แนะนำ TypeScript สำหรับ cloud-hub; ฝั่ง repo นี้ให้คงเป็น JavaScript (CommonJS) ตามโค้ดเดิม และใช้ schema ของ `bridge-protocol` ผ่านไฟล์ JS ที่ build แล้วหรือ JSDoc — เสนอทางเลือกก่อนลงมือ
- ก่อนทำ Task A3 ให้อ่าน `docs/ARCHITECTURE.md` และ `docs/MODULE_MAP.md` แล้วเสนอว่า `ai-bridge` ควรอยู่ใน backend process หรือ Electron main และจะอ่านข้อมูลผ่าน service ตัวไหนแบบ read-only
