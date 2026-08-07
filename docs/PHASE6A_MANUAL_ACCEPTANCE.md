# Phase 6A — Manual Windows Acceptance

สถานะ: **PENDING** — automated tests ไม่ถือเป็น Windows/Electron acceptance

ใช้ Windows 11 test machine/VM และ isolated data เท่านั้น ตรวจ: หน้าต่างเปิดหลัง Backend พร้อม, process เดียว, instance ที่สอง focus ของเดิม, Login/Theme/UI scale, POS/Reservation, Hardware Manager โดยไม่ส่ง Relay command, graceful close, Backend crash/restart ceiling, port conflict, valid/corrupt/power-loss migration, source ไม่ถูกลบ, Customer Data อยู่ `%LOCALAPPDATA%`, Program directory ไม่มี transaction data, receipt/Wiring Sheet และจอ 1366×768/1920×1080

บันทึกผล หลักฐาน และ failure code ทุกข้อ ห้ามใช้ร้านจริงหรือ hardware ที่ต่อโหลดไฟบ้าน
