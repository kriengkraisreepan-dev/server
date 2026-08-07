# อัปโหลด Firmware ลง ESP32

## 1. ต่อบอร์ด

1. **ยังไม่ต้องต่อไฟบ้านหรือโหลดจริง**
2. เสียบสาย USB data จาก ESP32 เข้าคอมพิวเตอร์
3. รอ Windows ติดตั้งอุปกรณ์สักครู่

[Screenshot: ESP32 connected by USB]
[Screenshot: COM Port in Windows Device Manager]

หากต้องดู COM Port: คลิกขวาปุ่ม Start → **Device Manager** → เปิดหัวข้อ **Ports (COM & LPT)** → มองหารายการ USB Serial เช่น `COM3`

## 2. Upload

1. กลับไป VS Code ที่เปิดโฟลเดอร์ `firmware`
2. กดลูกศรขวา **→ Upload** ที่ PlatformIO Toolbar ด้านล่าง
3. รอจนขึ้น `SUCCESS`

[Screenshot: Upload Button]

หาก ESP32 ค้างที่ `Connecting...` ให้กดปุ่ม **BOOT** บนบอร์ดค้างไว้ระหว่างเริ่ม Upload แล้วปล่อยเมื่อการเขียนเริ่มทำงาน

## 3. Serial Monitor

1. ที่แถบ PlatformIO กดไอคอนปลั๊ก/คำว่า **Monitor**
2. เลือกความเร็ว `115200`
3. กดปุ่ม **EN/Reset** บน ESP32 หนึ่งครั้งถ้าหน้าจอว่าง

คำสั่งทางเลือก:

```powershell
pio device monitor -b 115200
```

ให้มองหา `BOOT_COMPLETE` และยืนยันว่า Relay ทุกช่องยัง OFF ก่อนต่อโหลดจริง

```text
Power ON
  ↓
GPIO ทุกช่อง = HIGH (OFF)
  ↓
อ่านการตั้งค่า
  ↓
Wi‑Fi / API เริ่มทำงาน
  ↓
BOOT_COMPLETE
```

### ✓ Expected Result

Upload สำเร็จและ Serial Monitor แสดงข้อความเริ่มระบบโดยไม่มีการสั่ง Relay ON

### ✓ Common Mistakes

- ไม่มี COM Port เพราะใช้สายชาร์จอย่างเดียว
- เปิด Serial Monitor อยู่ระหว่าง Upload
- เลือก COM Port ของอุปกรณ์อื่น

### ✓ How to Fix

เปลี่ยนสาย USB data, ปิด Monitor ก่อน Upload, ตรวจ Device Manager และถอด/เสียบบอร์ดใหม่
