# Phase 6A — Manual Windows Acceptance

สถานะ: **PENDING** — automated tests ไม่ถือเป็น Windows/Electron acceptance

ใช้ Windows 11 test machine/VM และ isolated data เท่านั้น ตรวจ: หน้าต่างเปิดหลัง Backend พร้อม, process เดียว, instance ที่สอง focus ของเดิม, Login/Theme/UI scale, POS/Reservation, Hardware Manager โดยไม่ส่ง Relay command, graceful close, Backend crash/restart ceiling, port conflict, valid/corrupt/power-loss migration, source ไม่ถูกลบ, Customer Data อยู่ `%LOCALAPPDATA%`, Program directory ไม่มี transaction data, receipt/Wiring Sheet และจอ 1366×768/1920×1080

บันทึกผล หลักฐาน และ failure code ทุกข้อ ห้ามใช้ร้านจริงหรือ hardware ที่ต่อโหลดไฟบ้าน

## ความคืบหน้า

Defect 01 (`HARDWARE_SECRET_MISSING` ทำให้ Backend ล้มหลัง Legacy Data Handoff ทุกร้านที่มีฮาร์ดแวร์) พบและแก้แล้ว ดู [PHASE6A_MANUAL_DEFECT_01_HARDWARE_SECRET_VAULT_MIGRATION.md](PHASE6A_MANUAL_DEFECT_01_HARDWARE_SECRET_VAULT_MIGRATION.md) ตรวจซ้ำผ่านแล้ว: window เปิดหลัง backend พร้อม, single-instance lock, login, POS/Reservation/Hardware Manager (ไม่ส่ง relay command), migration ปกติ/hash mismatch/power-loss (automated), graceful close, source ไม่ถูกลบ

เหลือ: ความละเอียดจอ 1366×768 และ 1920×1080, การพิมพ์ใบเสร็จ/Wiring Sheet — ต้องทดสอบบนเครื่อง/จอ/เครื่องพิมพ์จริง สถานะรวมยังเป็น `PENDING`
