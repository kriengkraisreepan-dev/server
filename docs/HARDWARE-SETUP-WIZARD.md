# Sprint 12A — Hardware Setup Wizard

## One-click New Install handoff

เมื่อเริ่มจาก USB Flasher ระบบใช้ Device Key จาก pending enrollment ภายใน Backend ทำ nonce/HMAC verification แล้วเปิด Wizard ที่ขั้น Relay Test โดยไม่ถาม Device Key ผู้ใช้ Generic Wizard ต้องไม่มีค่าเริ่มต้นหรือคำแนะนำให้ใช้ legacy/shared key หาก Server restart ก่อน commit ให้หยุดแบบ fail closed และทำตาม Test Hardware recovery ใน `PHASE5-USB-FLASHER.md`

## Purpose

Wizard เพิ่มขั้นตอนตั้งค่า Lucky Relay Controller แบบภาษาไทยสำหรับเจ้าของร้านที่ไม่จำเป็นต้องรู้ REST API, PlatformIO หรือ HTTP headers โดยคง Hardware Manager แบบเดิมไว้ครบถ้วน

## Architecture

```text
Wizard UI
  → /api/hardware/setup/*
  → HardwareSetupWizardService (draft/verification/auth/safe pulse)
  → RelayControllerDriver (bounded HTTP)
  → Lucky Relay Controller

Final save
  → HardwareService.saveVerifiedSetup()
  → HardwareRepository
  → data/hardware-devices.json
```

Draft อยู่ในหน่วยความจำของ server และไม่เขียนอุปกรณ์ถาวรก่อนกดบันทึก การบันทึกค้นหาอุปกรณ์ด้วย `deviceId`; ถ้ามีอยู่แล้วจะอัปเดต record เดิม จึงรักษา `id` และ table-to-relay mappings ไว้

## User flow

1. Welcome และ checklist
2. กรอก IPv4 ของกล่อง
3. ตรวจ health, identity, relay configuration และ relay states
4. กรอกรหัสอุปกรณ์และยืนยัน All Off
5. ทดสอบ Relay ทีละช่อง
6. ตั้งชื่อและตำแหน่ง
7. บันทึกและแสดงผลสำเร็จ

ระบบไม่มี LAN discovery เดิม จึงใช้ manual IPv4 fallback และไม่ทำ subnet scan

## Feature flag

ค่าอยู่ที่ `settings.hardware.setupWizardEnabled` ค่าเริ่มต้น `true`

ปิดด้วยการอัปเดต settings ให้เป็น:

```json
{"hardware":{"setupWizardEnabled":false}}
```

เมื่อปิด ปุ่ม Wizard จะไม่ปรากฏ แต่หน้าเพิ่ม/แก้ไข/ลบ/ทดสอบอุปกรณ์แบบเดิมและ API เดิมยังทำงานตามปกติ

## Service responsibilities

- `HardwareSetupWizardService`: draft lifecycle, normalized verification, authentication, safe relay pulse, cleanup และ final save coordination
- `RelayControllerDriver`: HTTP timeout, API-key header และ firmware contract
- `HardwareService`: permanent save/update และ redaction
- `HardwareRepository`: atomic JSON persistence
- `HardwareWizardError`: Thai user message, recovery guidance และ retryable flag

## Error codes

`DEVICE_NOT_FOUND`, `DEVICE_TIMEOUT`, `NETWORK_UNREACHABLE`, `INVALID_DEVICE_RESPONSE`, `UNSUPPORTED_API_VERSION`, `DEVICE_ID_MISMATCH`, `RELAY_COUNT_MISMATCH`, `WIFI_DISCONNECTED`, `AUTHENTICATION_FAILED`, `RELAY_TEST_FAILED`, `RELAY_CLEANUP_FAILED`, `DEVICE_ALREADY_EXISTS`, `SAVE_FAILED`, `OPERATION_CANCELLED`, `UNKNOWN_ERROR`

Frontend ได้เฉพาะข้อความที่ปลอดภัย รายละเอียด exception ใช้ใน structured server log เท่านั้น

## Security

- API key ส่งใน JSON body จาก password field ไปยัง backend ผ่าน same-origin API แล้วเก็บชั่วคราวใน memory draft
- Backend ส่ง key ไป firmware ด้วย `X-Lucky-Device-Key`
- Key ไม่อยู่ใน URL, localStorage, API response หรือ structured Wizard log
- Cancel และ complete ล้าง key/draft
- Permanent storage ยังคงรูปแบบ Hardware Manager เดิมใน `hardware-devices.json`; การเข้ารหัส at-rest เป็น security-hardening sprint ภายหลัง

## Relay safety

การตรวจรหัสอุปกรณ์ใช้ `POST /api/v1/device/verify` ซึ่งไม่เปลี่ยน Relay การปิดหรือ pulse Relay เกิดขึ้นเฉพาะขั้นทดสอบ Relay/ปุ่มฉุกเฉินที่ผู้ใช้ยืนยันแยกต่างหาก

Pulse ใช้ลำดับ All Off → ON → รอ 1 วินาที (server จำกัดสูงสุด 3 วินาที) → OFF → GET relays ยืนยัน OFF → final All Off ใน `finally`

ทดสอบพร้อมกันไม่ได้ ปุ่มฉุกเฉิน All Off ใช้ได้ตลอด ผู้ใช้ต้องยืนยัน safety checkbox ก่อน pulse หากข้ามช่อง อุปกรณ์ถูกบันทึกเป็น `WARNING/PARTIAL` ระบบยืนยันเฉพาะคำสั่ง software ไม่อ้างว่าหลอดไฟจริงทำงาน

## Tests

```powershell
node --test tests/sprint12a-hardware-wizard.test.js tests/sprint12a-hardware-wizard-ui.test.js
npm.cmd test
npm.cmd run check
```

Firmware build:

```powershell
cd firmware
pio run -e esp32dev
```

## Known limitations

- ไม่มี mDNS/LAN discovery จึงกรอก IPv4 เอง
- ไม่มี physical lamp feedback
- Draft หายเมื่อ server restart โดยไม่กระทบอุปกรณ์ที่บันทึกแล้ว
- API key at rest ใช้ storage เดิมและยังไม่ได้เข้ารหัส
- Browser close ไม่รับประกันว่าจะส่ง cancel requestสำเร็จ; pulse timeout และ backend `finally` ยังคงทำ OFF/All Off

## Manual acceptance

ใช้ `192.168.1.191` เฉพาะในการทดสอบ ห้าม hardcode production:

1. IP/key ถูกต้อง
2. IP ผิด, key ผิด, ปิดกล่อง
3. คอมพิวเตอร์ 5 GHz และกล่อง 2.4 GHz บน router เดียวกัน
4. อยู่คนละ network
5. reboot ระหว่าง verify และ relay pulse
6. cancel ระหว่าง relay test แล้วตรวจ All Off
7. ตั้ง relay count 2/4/8
8. ตั้งอุปกรณ์เดิมซ้ำและตรวจว่า mapping เดิมอยู่ครบ
9. restart application หลัง save

`GET /` ตอบ `ROUTE_NOT_FOUND` เป็นพฤติกรรมปกติ ให้ตรวจเฉพาะ `/api/v1/*`

## Rollback

วิธีปลอดภัยที่สุดคือปิด `hardware.setupWizardEnabled` หน้า Hardware Manager เดิมจะกลับมาทำงานโดยไม่ต้องลบข้อมูล หากถอดโค้ด ให้ลบ service/error/tests/docs ของ Sprint 12A และ routes/UI block ที่ระบุ Sprint 12A โดยไม่แก้ `hardware-devices.json`
