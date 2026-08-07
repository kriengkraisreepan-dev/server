# Phase 5.5 Manual Acceptance Defect 05 — USB Adoption Preflight HTTP 500

สถานะ: แก้ไขใน Internal Portable Revision 7 (`INTERNAL TEST — NOT FOR PRODUCTION`)

## สาเหตุ

`WindowsSerialRecoveryTransport` เดิมคืน machine code แต่ไม่มี HTTP status เมื่อ USB timeout หรือสื่อสารไม่ได้ ข้อผิดพลาดจึงถูก Hardware controller ตอบเป็น HTTP 500 และข้อความทั่วไป ทำให้ไม่ทราบว่า preflight หยุดที่ IDENTIFY หรือ GET_RELAY_SAFETY

## การแก้ไข

- แยก `USB_IDENTIFY_TIMEOUT`, `USB_RELAY_SAFETY_TIMEOUT`, `USB_SERIAL_RESPONSE_INVALID`, `USB_PORT_BUSY`, `USB_DEVICE_ID_MISMATCH`, `RELAY_SAFE_STATE_CONFLICT`, `DEVICE_ID_DUPLICATE` และ `USB_ADOPTION_PREFLIGHT_FAILED`
- กำหนด HTTP status และข้อความไทยที่ดำเนินการต่อได้ให้ transport errors
- เพิ่ม operational log ที่มี route, errorCode, preflightStage, durationMs, COM Port และ Device ID เฉพาะหลังอ่านสำเร็จ
- log ไม่รับ serial payload, Setup Code, Device Key หรือ adoption token
- Browser เก็บ Setup Code ไว้จน token preflight สำเร็จ แล้วจึงล้างก่อนเรียก adoption start
- preflight ที่ล้มเหลวไม่เรียก start, ไม่สร้าง candidate Device Key, ไม่ใช้ Setup Code attempt และไม่เปลี่ยน Relay

## ขั้นตอน preflight

```text
DRAFT_VALIDATION
→ COM_PORT_VALIDATION
→ IDENTIFY
→ GET_RELAY_SAFETY
→ DUPLICATE_RECORD_CHECK
→ TOKEN_CREATION
```

หากล้มเหลว ให้แก้ตามข้อความภาษาไทยแล้วเริ่ม preflight ใหม่ ห้าม Flash Firmware ซ้ำ และห้ามเลือก New Install

Manual Hardware Acceptance ยังคง `PENDING` และต้องหยุดก่อนเปิด Revision 7 หรือ Retry COM3 จริง

