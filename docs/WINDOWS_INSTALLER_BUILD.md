# Windows Installer (NSIS) — Build Guide

สถานะ: การตั้งค่า (`package.json` "build" section, electron-builder) เสร็จแล้ว **แต่การรัน build จริงต้องทำนอก sandbox ของ Claude Code** เพราะขั้นตอนสุดท้ายต้องรันไฟล์ `makensis.exe` ที่ดาวน์โหลดใหม่ ซึ่ง sandbox บล็อกการรันไฟล์ปฏิบัติการที่ไม่รู้จักไว้เป็นมาตรการความปลอดภัย (ทดสอบแล้ว: packaging สำเร็จ, ดาวน์โหลด NSIS resource สำเร็จ, แต่ `spawn EPERM` ตอนจะรัน `makensis.exe`)

## วิธี build เอง (รันครั้งเดียว ไม่กี่นาที)

เปิด PowerShell หรือ Command Prompt ปกติ (ไม่ใช่ผ่าน Claude Code) ที่โฟลเดอร์โปรเจกต์ แล้วรัน:

```
npm run build:win-installer
```

ผลลัพธ์จะได้ที่ `dist_installer\88 Snooker Manager Setup 1.0.0.exe` (ประมาณ 90-100 MB)

## ข้อควรรู้

- **ยังไม่มีตัวเซ็นโค้ด (code signing certificate)** — Windows SmartScreen จะเตือน "Windows protected your PC" ตอนเปิดตัวติดตั้งครั้งแรกบนเครื่องปลายทาง ต้องกด **"More info" → "Run anyway"** เอง เป็นเรื่องปกติสำหรับซอฟต์แวร์ที่ไม่ได้เซ็นโค้ด ไม่ใช่ไวรัส
- ตัวติดตั้งเป็นแบบ **per-user** (`perMachine: false`) ไม่ต้องสิทธิ์ Administrator, ให้ผู้ใช้เลือกโฟลเดอร์ติดตั้งเองได้ (`allowToChangeInstallationDirectory: true`), สร้าง shortcut บน Desktop และ Start Menu อัตโนมัติ
- ไม่มีไอคอนแอปกำหนดเอง จะใช้ไอคอน Electron ค่าเริ่มต้นไปก่อน (แก้ได้ทีหลังโดยเพิ่ม `.ico` แล้วระบุ `build.win.icon` ใน `package.json`)
- `dist_installer/` ถูกใส่ใน `.gitignore` แล้ว (ไฟล์ binary ขนาดใหญ่ ไม่ควรเข้า git)
- ถ้าเจอ error ตอน build บนเครื่องจริงเกี่ยวกับไฟล์ค้าง/ลบไม่ได้ใน `dist_installer/win-unpacked.tmp` ให้ลบโฟลเดอร์ `dist_installer` ทิ้งทั้งหมดก่อนรันใหม่

## สิ่งที่ตัวติดตั้งบรรจุอยู่

เฉพาะไฟล์ที่จำเป็นต่อการรันจริง (`index.js`, `electron/`, `public/`, `services/`, `repositories/`, `domain/`, `infrastructure/`, `drivers/`, `config/`) และ Electron runtime — **ไม่รวม** ไฟล์ทดสอบ (`tests/`), เอกสาร (`docs/`), เครื่องมือพัฒนา (`scripts/`, `tools/`), หรือข้อมูลลูกค้า (`data/`)
