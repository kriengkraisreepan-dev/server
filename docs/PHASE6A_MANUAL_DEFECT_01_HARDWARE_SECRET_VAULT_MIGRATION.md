# Phase 6A Manual Acceptance Defect 01 — Resolution

Defect: ระหว่าง Manual Windows Acceptance ครั้งแรก แอป Electron เปิดไม่สำเร็จเลยแม้แต่ครั้งเดียว — Legacy Data Handoff คัดลอกข้อมูลเดิมสำเร็จ แต่ Backend ล้มทันทีด้วย `HARDWARE_SECRET_MISSING` วนซ้ำจนครบโควตา restart (3 ครั้ง/5 นาที) แล้วปิดตัวเอง เกิดกับร้านที่มีอุปกรณ์ ESP32 ตั้งค่าไว้แล้วทุกกรณี (100% reproducible)

Root cause: `services/legacy-data-handoff-service.js` มีรายการไฟล์ที่ย้าย (`REQUIRED`) ครอบคลุมแค่ `store.json`, `reservations.json`, `reservation-deposits.json`, `hardware-devices.json` — ไม่รวม `config/hardware-secrets.dpapi.json` เข้าไปด้วย ผลคือ `hardware-devices.json` ที่มี `secretId` อ้างอิงถูกย้ายไปที่ปลายทาง แต่ตู้เซฟ DPAPI ที่เก็บ secret จริงไม่ถูกย้ายตาม ปลายทางได้ vault ว่างเปล่าแทน `HardwareSecretVault`/`HardwareRepository` ออกแบบ fail-closed ไว้ถูกต้องอยู่แล้ว (มี test คลุม) จึง throw ตามสเปค แต่ปัญหาที่แท้จริงอยู่ที่ขั้นตอน migration ไม่ครบ

Resolution: เพิ่ม `config/hardware-secrets.dpapi.json` (และ `.bak`) เข้าไปใน manifest/copy/activate ของ `LegacyDataHandoffService` เป็นไฟล์ optional แยกจาก `REQUIRED` (ร้านที่ไม่เคยตั้งค่าฮาร์ดแวร์จะไม่มีไฟล์นี้และย้ายข้อมูลได้ตามปกติ) เพิ่ม `"config"` เข้า directory list ที่ใช้ตรวจ hash/activate/resume-from-recovery คู่กับ `database`/`backups` เดิม

เทสต์ที่เพิ่ม: `tests/phase6a-legacy-data-handoff.test.js` — "hardware secret vault under config is migrated alongside device records", "legacy data without a hardware secret vault still migrates cleanly" รวมชุดเดิมผ่านครบ 10/10 และ `node --test tests/*.test.js` ผ่านครบ 285/285 (ไม่มี regression)

ตรวจซ้ำจริง: รัน `npm run start:electron` กับข้อมูลร้านจริงที่คัดลอกมา (มีอุปกรณ์ 2 ตัว, secret 2 รายการ) ผ่าน dialog Legacy Data Handoff จริง → migration สำเร็จ, hash ต้นทาง/ปลายทางตรงกัน, vault ปลายทางมี secret ครบ 2 รายการตรงกับต้นฉบับ, backend ขึ้น `SERVER_STARTED` ไม่มี crash, login สำเร็จ, ปิดโปรแกรมแบบ graceful (runtime marker ถูกลบ, ไม่มี process ค้าง) ต้นฉบับ `data/` ไม่ถูกแก้ไข/ลบ

สิ่งที่ไม่เปลี่ยน: schema ของ `HardwareSecretVault`, พฤติกรรม fail-closed เมื่อ secret หายจริง (เจตนา ไม่ใช่บั๊ก), รายการไฟล์ `REQUIRED` เดิม, ลำดับขั้นตอน migration (verify → recovery copy → activate)

Manual acceptance ยังคง `PENDING` — เหลือ 2 ข้อที่ต้องทดสอบบนเครื่อง/จอจริงเท่านั้น: ความละเอียดจอ 1366×768 และ 1920×1080, การพิมพ์ใบเสร็จ/Wiring Sheet ข้ออื่นในเช็คลิสต์ผ่านแล้วระหว่างตรวจซ้ำจริงข้างต้น
