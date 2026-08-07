# ทดสอบ Safe Boot

Safe Boot หมายถึง เมื่อ ESP32 เริ่มทำงาน Firmware จะสั่ง GPIO Relay ทั้ง 8 ช่องเป็น OFF ก่อนอ่าน Wi‑Fi หรือเปิด API

## ขั้นตอน

1. ถอดโหลดไฟบ้านออก หรือให้ช่างแยกวงจรไว้
2. เปิด Serial Monitor ที่ `115200`
3. ถอดสาย USB/ไฟเลี้ยง ESP32
4. รอ 10 วินาที
5. เสียบไฟกลับ
6. สังเกต LED Relay และ Serial Monitor จนเห็น `BOOT_COMPLETE`
7. เรียก `GET /api/v1/relays` และตรวจทุกช่องเป็น `OFF`

[Screenshot: Safe boot serial log]

```text
ไฟดับ → ESP32 เริ่มใหม่ → GPIO HIGH/OFF ทุกช่อง → BOOT_COMPLETE
```

### ✓ Expected Result

ไม่มี Relay ช่องใดค้าง ON, ไม่มีไฟโต๊ะเปิดเอง, และ API รายงาน OFF ทุกช่อง

### ✓ Common Mistakes

- ฟังเสียงคลิกเพียงอย่างเดียวโดยไม่ได้ตรวจสถานะ API
- ทดสอบขณะต่อโหลดไฟบ้านโดยไม่มีช่างดูแล

### ✓ How to Fix

ตรวจ LED และ API ร่วมกัน; แยกโหลดจริงจนกว่าการทดสอบ Logic ผ่าน
