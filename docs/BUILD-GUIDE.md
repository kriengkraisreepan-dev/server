# สร้าง Firmware ด้วย VS Code และ PlatformIO

เริ่มจาก [BEGINNER-GUIDE.md](BEGINNER-GUIDE.md) หากยังไม่รู้จักเครื่องมือ

## 1. ติดตั้ง VS Code

1. เปิด Browser ไปที่ [Visual Studio Code](https://code.visualstudio.com/)
2. กดปุ่ม **Download for Windows**
3. เปิดไฟล์ที่ดาวน์โหลด แล้วกด **Next** ตามลำดับ
4. เมื่อเห็นปุ่ม **Install** ให้กด และรอจนเสร็จ
5. กด **Finish** เพื่อเปิด VS Code

[Screenshot: VS Code download page]

## 2. ติดตั้ง PlatformIO

1. ใน VS Code มองแถบไอคอนซ้ายมือ
2. กดไอคอนรูปสี่เหลี่ยม 4 ช่อง (Extensions)
3. ช่องค้นหาด้านบน พิมพ์ `PlatformIO IDE`
4. เลือกรายการชื่อ **PlatformIO IDE** โดย PlatformIO
5. กด **Install**
6. รอจนติดตั้งเสร็จ แล้วกด **Reload/Restart** หากโปรแกรมถาม

[Screenshot: Extensions icon]
[Screenshot: Search PlatformIO IDE]

## 3. เปิดโครงการ

1. เลือกเมนู **File → Open Folder...**
2. ไปที่ `C:\Users\Windows 11\Desktop\88Snooker Club\server\firmware`
3. เลือกโฟลเดอร์ `firmware` แล้วกด **Select Folder**
4. ถ้ามีข้อความถามว่าเชื่อถือโฟลเดอร์นี้หรือไม่ ให้เลือก **Yes, I trust the authors** เฉพาะเมื่อเป็นไฟล์ของร้านคุณ

ด้านซ้ายควรเห็น `platformio.ini`, `src`, `include`, `docs`

## 4. กำหนดค่า Wi‑Fi และ Device Key อย่างปลอดภัย

Firmware จะไม่ยอมให้ POST เปิด/ปิด Relay ถ้า Device Key ว่าง นี่เป็นความปลอดภัยที่ตั้งใจไว้

ให้ผู้ดูแลระบบเตรียมค่า private แล้วเพิ่มในสำเนาการตั้งค่าที่ไม่ Commit:

```ini
build_flags =
  -D LUCKY_BOOTSTRAP_WIFI_SSID=\"ชื่อWiFiร้าน\"
  -D LUCKY_BOOTSTRAP_WIFI_PASSWORD=\"รหัสWiFiร้าน\"
  -D LUCKY_BOOTSTRAP_API_KEY=\"DeviceKeyที่ยาวและเดายาก\"
```

อย่าใส่รหัสจริงในเอกสาร ภาพหน้าจอ หรือ Git

## 5. Build

1. ดูแถบล่างของ VS Code
2. กดเครื่องหมายถูก **✓ Build** ของ PlatformIO
3. รอจนหน้าต่างด้านล่างหยุดเลื่อน

[Screenshot: PlatformIO Toolbar]
[Screenshot: Click Build]

- ข้อความ **SUCCESS** หรือเครื่องหมายถูกสีเขียว = สร้าง Firmware สำเร็จ
- เครื่องหมายกากบาทสีแดง = มีข้อผิดพลาด ให้อ่านบรรทัดแดงบรรทัดแรก

ทางเลือกสำหรับผู้ชำนาญ Command Prompt:

```powershell
cd "C:\Users\Windows 11\Desktop\88Snooker Club\server\firmware"
pio run -e esp32dev
```

### ✓ Expected Result

Build จบด้วย `SUCCESS`; โครงการจริงใช้ environment `esp32dev`, Arduino framework และ Serial Monitor 115200

### ✓ Common Mistakes

- เปิดโฟลเดอร์ `server` แทน `server\firmware`
- ยังติดตั้ง PlatformIO ไม่เสร็จ
- แก้ `platformio.ini` จน environment `esp32dev` หาย

### ✓ How to Fix

เปิดโฟลเดอร์ให้ถูก, รอ PlatformIO ติดตั้งครบแล้ว Restart VS Code, และคืนค่า `default_envs = esp32dev`
