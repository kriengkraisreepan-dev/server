# Phase 6A — Legacy Data Handoff

ระบบตรวจเฉพาะ `<application-root>\data` และไม่ค้นหา `output/pre-production-archive-*`

สถานะ: `NO_LEGACY_DATA`, `LEGACY_DATA_AVAILABLE`, `MIGRATION_ALREADY_COMPLETE`, `MIGRATION_INCOMPLETE`, `LEGACY_DATA_INVALID`, `LEGACY_DATA_AMBIGUOUS`

Transaction: ตรวจ schema → lock → source manifest (size/SHA-256 เท่านั้น) → copy staging → ตรวจ hash/JSON → recovery copy → activate `database`/`backups` → reopen/hash → marker → commit ต้นฉบับไม่ถูก move หรือลบ

Journal ระบุ run/stage/hash โดยไม่มี record หรือ secret หากไฟดับระหว่าง activate รอบถัดไปเติม staging จาก recovery, ยอมรับ destination เฉพาะ directory ที่ตรง manifest ทุกไฟล์ และเดินหน้าต่อ ถ้ามีข้อมูลอื่นอยู่จะ fail closed

ห้ามแก้ ambiguity อัตโนมัติ ห้ามลบ Customer Data root เพื่อ rollback การกู้ให้เก็บ source, `.recovery-*`, source manifest และ journal ไว้ แล้วตรวจด้วย workflow แยก
