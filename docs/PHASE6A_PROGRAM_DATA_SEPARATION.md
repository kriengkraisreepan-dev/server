# Phase 6A — Program/Customer Data Separation

Production Customer Data อยู่ที่ `%LOCALAPPDATA%\Lucky Snooker Manager\` และแยกเป็น `database`, `backups`, `config`, `license`, `logs`, `uploads`, `update-staging`, `migration`, `runtime`

Electron Main เป็นผู้กำหนด `LUCKY_DATA_ROOT`; Browser เลือกหรืออ่าน absolute path ไม่ได้ Backend ตรวจ absolute/canonical path และปฏิเสธ relative path, drive root, UNC, Program Files, program/workspace root และ symlink/reparse escape

Repositories ของ store, reservations, deposits และ hardware records ใช้ `database`; backup ใช้ `backups`; operational logs ใช้ `logs` ส่วน uploads/update staging ถูกเตรียมเป็น allowlist สำหรับงานในอนาคตโดย Phase 6A ไม่เพิ่ม update/download behavior

เมื่อไม่มี `LUCKY_DATA_ROOT` การรัน Node แบบเดิมยังใช้ `<application-root>\data` พร้อม warning สำหรับ development compatibility เท่านั้น
