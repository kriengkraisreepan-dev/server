# Phase 5.5 — Internal Portable Test Package

สร้างด้วย `npm run build:phase5.5-portable` เป็น ZIP แบบ unpack-and-run ไม่ใช่ installer ไม่มี Windows service, registry registration, auto-update หรือ production signing

Package มี Electron/Backend/runtime dependencies และ marker/title/README `INTERNAL TEST — NOT FOR PRODUCTION` ใช้ข้อมูลทดสอบแยกที่ `%LOCALAPPDATA%\Lucky Snooker Manager Internal Test`

ห้ามแจกจ่ายลูกค้า ห้ามรับข้อมูลจริง และห้ามถือว่าผ่านจนกว่าจะ extract/run บน Windows 10 22H2 x64 และ Windows 11 x64 ที่ไม่มี Node/npm/Python/PlatformIO/VS Code
