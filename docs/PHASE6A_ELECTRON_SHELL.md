# Phase 6A — Electron Shell

สถานะ implementation ภายใน: Electron main process เป็นเจ้าของ single-instance lock, เลือก loopback port, เริ่ม Backend เพียง process เดียว, รอ HTTP readiness สูงสุด 30 วินาที แล้วจึงแสดงหน้าต่างโปรแกรม

Toolchain ที่ล็อก: Electron `43.2.0` แบบ exact pin (MIT), bundled Node `24.18.0`, Chromium `150.0.7871.129` บน Windows 11 ไม่มี packager หรือ installer ใน Phase 6A แพ็กเกจมาจาก npm registry ตาม integrity ใน `package-lock.json`; binary `electron.exe` ที่ติดตั้งมี SHA-256 `8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f` และขนาด 225,613,824 bytes ตรวจซ้ำได้ด้วย `npm run inventory:phase6a`

ขอบเขต process:

- Main: path, process lifecycle, window, CSP และ fixed IPC
- Preload: `getAppInfo()` และ `getRuntimeStatus()` เท่านั้น
- Renderer: UI เดิม ไม่มี Node.js/filesystem/process access
- Backend: business services เดิม รับ trusted data root จาก Main

Backend bind ที่ `127.0.0.1` บน ephemeral port และ UI เปิดหลัง readiness สำเร็จเท่านั้น หาก crash จะลองใหม่ไม่เกิน 3 ครั้งใน 5 นาที การปิดโปรแกรมรอ Backend สูงสุด 10 วินาทีและ Backend รอ atomic JSON writes ก่อนออก

Development ใช้ `npm run start:electron` และสร้าง data root แยกต่อ run ใต้ `runtime/electron-test-user-data/` ห้ามใช้ข้อมูล production สำหรับ acceptance

Rollback: ปิด Electron launcher แล้วใช้ `npm start` ใน legacy browser/server mode ได้ โดยไม่ลบ legacy source, Customer Data หรือ migration recovery
