# Phase 5.5 Revision 4 — Post-Flash Recovery

สถานะ: `IMPLEMENTED — MANUAL HARDWARE ACCEPTANCE PENDING`

Revision 3 hardware acceptance พบว่า Existing Update เขียน application ที่ `0x10000` สำเร็จ แต่ Firmware synchronized ค่า runtime firmware version ลง NVS ตอน boot ทำให้ SHA-256 ของ NVS ทั้ง partition เปลี่ยน ระบบเดิมจึงหยุดด้วย `NVS_CHANGED_DURING_UPDATE` ก่อน post-flash identity verification

Revision 4 ไม่ลดเงื่อนไขความปลอดภัยและไม่ถือว่า raw NVS mismatch ผ่านอัตโนมัติ การเปลี่ยนแปลงดังกล่าวเข้าสู่ `NVS_SEMANTIC_REAUTHENTICATION_REQUIRED` หลังตรวจ Firmware, Device ID, Relay Count และ Relay OFF แล้ว จากนั้น Device Key, Setup Code และ confirmed Wi-Fi ต้องผ่าน USB acceptance แยกก่อนปิด Hardware Acceptance

## No-write recovery

Hardware Manager เพิ่มตัวเลือก:

```text
ตรวจสอบงานอัปเดตเดิมต่อ — ไม่ Flash ซ้ำ
```

เส้นทางนี้ทำเฉพาะ:

1. ตรวจ signed internal-test package
2. ตรวจ Classic ESP32 และ Flash 4 MB
3. ใช้ `esptool verify_flash` เปรียบเทียบ application ที่ `0x10000`
4. อ่าน `IDENTIFY` ผ่าน Serial Recovery
5. ตรวจ Firmware `1.2.0`, Device ID, API และ Relay Count
6. อ่าน `GET_RELAY_SAFETY` และยืนยัน Relay ทุกช่อง OFF
7. รายงาน `COMPLETED` พร้อม `credentialVerification=PENDING_USB_ACCEPTANCE`

เส้นทาง recovery ไม่มี `write_flash`, ไม่อ่านหรือเขียน NVS, ไม่สร้าง Hardware record และไม่เปลี่ยน Relay state

## Fail-closed policy

- Firmware image ไม่ตรง: `FLASH_TOOL_FAILED`
- Firmware/Device ID/Relay Count ไม่ถูกต้อง: `POST_FLASH_VERIFICATION_FAILED`
- Relay ON: `POST_FLASH_RELAY_NOT_OFF`
- NVS raw hash เปลี่ยนระหว่าง update ใหม่: `NVS_SEMANTIC_REAUTHENTICATION_REQUIRED`
- ห้ามอ้างว่า credential preservation ผ่านจนกว่า USB acceptance ครบ

## Current operation recovery

สำหรับกล่องที่ Revision 3 Flash ไปแล้ว ห้าม Flash ซ้ำ ให้เปิด Revision 4 เลือก COM เดิมและเลือก no-write recovery หลังผ่านแล้วจึงทดสอบ Setup Code/Device Key rotation, confirmed Wi-Fi, Add Device และ mapping ตาม Manual Hardware Acceptance

## Verification

```text
Focused Revision 3/4 + USB Flasher: 15/15 PASS
Full regression: 258/258 PASS
Syntax checks: PASS
Secret scan: PASS
Archive scan: PASS — 1,471 entries
Firmware changed: NO
ESP32 build: NOT REQUIRED
Hardware flash after Revision 3 failure: NOT PERFORMED
```

## Revision 5 — Noisy Serial transport correction

Manual recovery ด้วย Revision 4 พบ `POST_FLASH_IDENTITY_FAILED` ขณะที่ ESP32 ยังทำงานและตอบ HTTP ปกติ การตรวจโดยตรงพบว่า Serial มี operational logs ค้างจำนวนมาก ตัวอ่านเดิมใช้ `ReadLine()` จึงไม่ถึง recovery response ภายใน timeout

Revision 5 เปลี่ยน Windows Serial transport เป็น chunked `ReadExisting()` พร้อม rolling buffer จำกัดขนาด ค้นหา exact `LUCKY_RECOVERY_RESPONSE:` และขยาย bounded timeout โดยยังไม่บันทึก log payload หรือ secret การตรวจจริงกับ COM3 ผ่านและคืน:

```text
Device ID: LRC-88A4750FF0A4
Firmware: 1.2.0
API: 1
Relay Count: 4
```

Firmware ไม่เปลี่ยนและไม่ต้อง Flash ซ้ำ
