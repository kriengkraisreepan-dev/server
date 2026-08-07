# การสร้าง Per-device NVS

Lucky-built generator มาจาก official ESP-IDF `v4.4.7` commit `38eeba213aa695aabfd6d89aa9f5078dbe5a94c3` และถูก bundle ด้วย Python 3.12.13/PyInstaller 6.11.1 ผู้ใช้ปลายทางไม่ต้องติดตั้ง Python หรือ PlatformIO ตัว executable นี้ไม่ใช่ official Espressif binary

Schema ที่ล็อก:

```text
Namespace lucky-relay
Offset    0x9000
Size      0x5000
```

| Key | Type | ค่า |
|---|---|---|
| `apiKey` | string | CSPRNG 32 bytes encoded base64url |
| `setupCode` | string | Base31 canonical 12 ตัว ไม่มีขีด |
| `setupVersion` | u8 | 1 |
| `wifiSSID` | string | ว่าง |
| `wifiPassword` | string | ว่าง |
| `relayCount` | u8 | ผู้ใช้เลือก 2, 4 หรือ 8 |

Device ID ไม่อยู่ใน image และ Firmware สร้างจาก eFuse MAC

CSV และ NVS อยู่ใน temporary directory ที่ Backend สร้างด้วยชื่อสุ่มและจำกัดสิทธิ์ Secret ไม่อยู่ใน command line/log/authorization record หลัง generator จบ Backend ตรวจขนาดและ SHA-256 แล้วเก็บเฉพาะ path/hash/offset/size/expiry ใน memory จากนั้นตรวจซ้ำก่อน Flash และลบ directory ทุก terminal path

การลบไฟล์เป็น best-effort logical deletion ระบบไฟล์/SSD อาจไม่รับประกัน physical overwrite จึงต้องใช้บัญชี Backend และ ACL ที่จำกัด การยืนยัน compatibility กับ Preferences จริงยังเป็น hardware acceptance gate

