# Sprint 12C — Unique Device Key และ Wi‑Fi Provisioning

## ขอบเขต

Phase 3 เพิ่มการสร้าง Device Key เฉพาะกล่องและการเปลี่ยนเครือข่าย Wi‑Fi จาก Hardware Manager โดยไม่เปลี่ยนสถานะ Relay อัตโนมัติ งานนี้ไม่รวม Setup AP, Captive Portal, ปุ่มกายภาพ, USB/One-click Flasher และ OTA

## ลำดับใช้งาน

1. สำรองข้อมูลและยืนยันว่ากล่องออนไลน์
2. ใน Hardware Manager เลือก **สร้างรหัสอุปกรณ์เฉพาะกล่อง**
3. Backend สร้าง key แบบสุ่ม 32 bytes, stage ด้วย key ปัจจุบัน, ตรวจ key ใหม่ด้วย nonce/HMAC และ commit หลังตรวจผ่านเท่านั้น
4. ปิดโต๊ะทุกโต๊ะผ่าน workflow ปกติ ให้ Relay ทุกช่องเป็น OFF
5. เลือก **เปลี่ยนเครือข่าย Wi‑Fi**, สแกนหรือกรอก SSID และยืนยันความปลอดภัย
6. ระบบตรวจ Relay ซ้ำ, ส่ง candidate, ค้นหา Device ID เดิมบนเครือข่ายใหม่, ตรวจ nonce/HMAC แล้วจึง commit และอัปเดต IP

กล่องที่ยังใช้ bootstrap key จะถูกปฏิเสธด้วย `UNIQUE_DEVICE_KEY_REQUIRED` โดยไม่มีทางเลือกให้ข้ามคำเตือน

## Transaction และระยะเวลา

- Candidate connection: 30 วินาที
- Commit window: 90 วินาที
- Backend rediscovery: 60 วินาที
- Reboot ระหว่าง key/Wi‑Fi transition: ยกเลิก candidate และใช้ค่าที่ commit ไว้เดิม
- Relay เปิดระหว่าง transition: rollback ด้วย `RELAY_SAFE_STATE_CONFLICT`

ระบบไม่สั่ง all-off อัตโนมัติ หากมี Relay ON จะรายงานหมายเลขช่องเพื่อให้ผู้ใช้ปิดโต๊ะด้วย workflow ปกติ

## Endpoint ของ Firmware

Device Key (authenticated):

- `POST /api/v1/device/key/candidate`
- `POST /api/v1/device/key/commit`
- `POST /api/v1/device/key/rollback`

Wi‑Fi (authenticated และต้องใช้ unique key):

- `GET /api/v1/wifi/networks`
- `GET /api/v1/wifi/provisioning/status`
- `POST /api/v1/wifi/provisioning/candidate`
- `POST /api/v1/wifi/provisioning/commit`
- `POST /api/v1/wifi/provisioning/rollback`

คำตอบของ API และ operational logs ห้ามมี Device Key หรือ Wi‑Fi password

## Security warning และ Phase 5 gate

Phase 3 ใช้ storage เดิมชั่วคราว Backend เขียนข้อมูลแบบ atomic และจำกัดสิทธิ์ไฟล์เท่าที่ระบบปฏิบัติการรองรับ UI แสดง key แบบ mask และไม่ส่ง secret กลับไปที่หน้าเว็บ

ก่อน production rollout ใน Phase 5 ต้องปิด gate ต่อไปนี้:

- ย้าย secret ฝั่ง Windows ไป DPAPI หรือ secret store ที่เหมาะสม
- กำหนด production flashing/recovery procedure
- ประเมินและเปิด NVS/Flash encryption ภายใต้ procedure ดังกล่าว

ห้ามถือว่าไฟล์ storage ปัจจุบันเป็นการเข้ารหัสข้อมูลลับ

## Acceptance

- Key ใหม่ต้องผ่าน nonce/HMAC ก่อน commit และ key เดิมยังใช้ได้เมื่อขั้นตอนล้มเหลว
- Wi‑Fi provisioning ต้องถูกบล็อกเมื่อใช้ bootstrap key
- Relay ON แม้หนึ่งช่องต้องถูกปฏิเสธ และไม่มีคำสั่ง all-off
- Device ID หลัง rediscovery ต้องตรงกับ record เดิม
- IP เปลี่ยนใน Backend หลัง verify และ commit สำเร็จเท่านั้น
- ตรวจว่า response/logs ไม่มี key หรือ password

