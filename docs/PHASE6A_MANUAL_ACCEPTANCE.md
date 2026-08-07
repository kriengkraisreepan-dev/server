# Phase 6A — Manual Windows Acceptance

สถานะ: **ผ่านครบทุกข้อ** — ตรวจซ้ำจริงบนเครื่อง Windows นี้พร้อมฮาร์ดแวร์จริง 1 กล่อง

ใช้ Windows 11 test machine/VM และ isolated data เท่านั้น ตรวจ: หน้าต่างเปิดหลัง Backend พร้อม, process เดียว, instance ที่สอง focus ของเดิม, Login/Theme/UI scale, POS/Reservation, Hardware Manager โดยไม่ส่ง Relay command, graceful close, Backend crash/restart ceiling, port conflict, valid/corrupt/power-loss migration, source ไม่ถูกลบ, Customer Data อยู่ `%LOCALAPPDATA%`, Program directory ไม่มี transaction data, receipt/Wiring Sheet และจอ 1366×768/1920×1080

บันทึกผล หลักฐาน และ failure code ทุกข้อ ห้ามใช้ร้านจริงหรือ hardware ที่ต่อโหลดไฟบ้าน

## ผลการตรวจ (ครบทุกข้อ)

ทุกข้อผ่านจริงระหว่างตรวจซ้ำบนเครื่องนี้ พร้อมกล่อง ESP32 จริง 1 ตัว ("Lucky Relay 01") เจอและแก้บั๊ก 2 รอบระหว่างทาง:

- [PHASE6A_MANUAL_DEFECT_01](PHASE6A_MANUAL_DEFECT_01_HARDWARE_SECRET_VAULT_MIGRATION.md) — Backend ล้มทุกครั้งหลัง Legacy Data Handoff สำหรับร้านที่มีฮาร์ดแวร์ (migration ไม่ย้าย DPAPI secret vault)
- [PHASE6A_MANUAL_DEFECT_02](PHASE6A_MANUAL_DEFECT_02_ARCHIVED_DEVICES_AND_WIRING_PRINT.md) — กล่องที่ถูกเปลี่ยนแทนแล้วโผล่เป็นการ์ดซ้ำและถูกดึงกลับมา ONLINE โดย background poller, พิมพ์ Wiring Sheet ได้หน้าว่าง

PR ที่แก้ทั้ง 4 รายการนี้ merge เข้า `master` เรียบร้อยแล้ว:
1. `fix/phase6a-migrate-hardware-secret-vault` — แก้ defect 01
2. `fix/hardware-auth-failure-flags-reauthentication` — เชื่อมปุ่มยืนยันอุปกรณ์อีกครั้งที่มีอยู่แล้วให้ทำงานจริงเมื่อ API Key ไม่ตรง
3. `feat/bill-history-reprint-receipt` — เพิ่มปุ่มพิมพ์ซ้ำใบเสร็จที่หายไปจาก Bill History
4. `fix/hardware-manager-archived-devices-and-wiring-print` — แก้ defect 02

เหลือทำนอกเหนือจาก Manual Windows Acceptance นี้: Hardware Acceptance ของกล่อง "Lucky Relay Test" (offline ตลอดเซสชัน — ข้ามตามคำสั่งเจ้าของร้าน เพราะเป็นกล่องสำรองไม่ได้ผูกกับโต๊ะใด), Production Key Ceremony (ข้าม — ใช้งานร้านเดียวไม่ได้จำหน่าย จึงไม่จำเป็น)
