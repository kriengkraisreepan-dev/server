# Sprint 12D — Setup AP และ Captive Portal

## สถานะ

- Software implementation: พร้อมสำหรับ software acceptance
- Physical Setup Button: `PENDING` จนกว่าจะต่อวงจรและผ่าน hardware acceptance
- Phase 5, OTA, Flasher, Factory Reset และ Remote Restart: ไม่อยู่ในขอบเขต

## Setup Code

Backend สร้าง Base31 Setup Code จาก alphabet ต่อไปนี้ด้วย cryptographically secure RNG และ rejection sampling:

```text
23456789ABCDEFGHJKMNPQRSTUVWXYZ
```

รหัสมี 12 ตัว แสดงเป็น `XXXX-XXXX-XXXX` และมี entropy ประมาณ 59.45 bits ขีดใช้เพื่อการแสดงผลเท่านั้น ผู้ใช้กรอกได้ทั้งแบบมีและไม่มีขีด และระบบไม่แก้ตัวอักษรผิดให้อัตโนมัติ

Enrollment/rotation ใช้ `stage → nonce/HMAC verify → commit` ผ่าน Unique Device Key ค่าเดิมยังทำงานจน commit สำเร็จ รหัสใหม่แสดงเต็มครั้งเดียวใน Hardware Manager แล้วเก็บเฉพาะสถานะ mask ฝั่ง Backend

Setup Code ใช้เป็นทั้ง WPA2 password และ Portal login เพื่อความสะดวก จึง **ไม่ใช่ two-factor authentication**

## State machine

```text
NORMAL → STARTING_AP → AP_ACTIVE → PORTAL_AUTHENTICATED
       → CONNECTING_CANDIDATE → WAITING_FOR_CONFIRMATION
       → COMMITTED → NORMAL

AUTH_FAILED → LOCKED_OUT → AP_ACTIVE
CANDIDATE_FAILED / AP_TIMEOUT / RELAY_SAFE_STATE_CONFLICT
       → ROLLBACK → ORIGINAL_NETWORK_RESTORED
```

ทุกขั้นทำงานใน `loop()` แบบ non-blocking และไม่เรียกคำสั่ง Relay ON/OFF

## ค่าความปลอดภัย

- กรอกรหัสผิด 5 ครั้ง: lockout 10 นาที
- Portal session: 10 นาที; idle timeout 5 นาที
- Setup AP: 15 นาที, client สูงสุด 1, IP `192.168.4.1`
- Automatic recovery eligibility: confirmed Wi‑Fi ขาด 60 วินาที
- Cooldown หลัง AP ปิด: 60 วินาที
- Candidate connection/commit ใช้ timeout และ NVS slots เดิมจาก Phase 3
- Request ที่มี credential จำกัดขนาดและใช้ POST
- Portal session ใช้ได้เฉพาะ `/setup/api/*` ไม่ใช่ Device Key และเรียก Relay/Factory Reset API ไม่ได้

Setup Code, Device Key, Wi‑Fi password และ portal token ห้ามปรากฏใน GET, logs, discovery, mDNS, UDP หรือ error response

## Setup AP และ Portal

SSID คือ `Lucky-Relay-<Device ID suffix>` และ WPA2 password คือ Setup Code เชื่อมต่อแล้วเปิด `http://192.168.4.1` Portal รองรับการ scan แบบ non-blocking และกรอก Hidden SSID เอง

หาก candidate ล้มเหลว ระบบเก็บ confirmed Wi‑Fi เดิมและกลับ Portal หาก commit สำเร็จจึงปิด AP ยกเลิก session และใช้ confirmed credentials ใหม่

### Captive Browser และ Transition ID

Portal ไม่ใช้ `crypto.randomUUID()` เพราะ API นี้อาจไม่มีใน iPhone Captive Network Assistant ที่เปิดผ่าน HTTP โดย Browser ต้องมี `crypto.getRandomValues()` เพื่อสร้าง client nonce ขนาด 16 bytes หาก Secure Random API ไม่มี ระบบจะแสดงข้อความภาษาไทยว่า Browser ไม่รองรับ หยุดแบบ fail closed และไม่ส่ง Wi‑Fi candidate

client nonce ไม่ใช่ Transition ID ที่เชื่อถือได้ Firmware เป็นผู้สร้าง Transition ID จริงด้วย ESP32 CSPRNG (`esp_fill_random`) เป็นเลขฐานสิบหก 48 ตัว แล้วผูกกับ Portal session ปัจจุบัน Candidate, commit และ rollback ต้องใช้ค่าเดียวกันเท่านั้น การออก Transition ID ใหม่, rollback หรือการยกเลิก session จะทำให้ค่าก่อนหน้าใช้ไม่ได้

รองรับ iPhone Captive Network Assistant, Safari บน iOS, Android Captive Portal และ Chrome/Edge เมื่อ Browser เปิดใช้ `crypto.getRandomValues()` ได้ ข้อความ exception ภาษาอังกฤษจาก JavaScript จะไม่ถูกแสดงแก่ผู้ใช้ และไม่มี Wi‑Fi password, Setup Code, portal session token, client nonce หรือ Transition ID ถูกเขียนลง application log

## Feature flags

- `LUCKY_SETUP_AP_ENABLED=1`
- `LUCKY_SETUP_BUTTON_ENABLED=0` ค่าเริ่มต้นและห้ามเปิดก่อน physical acceptance
- `LUCKY_AUTOMATIC_WIFI_RECOVERY_ENABLED=0` ค่าเริ่มต้นที่ปลอดภัย
- Backend: `hardware.setupApEnabled=true`, `setupButtonEnabled=false`, `automaticWifiRecoveryEnabled=false`

## GPIO34

บอร์ดที่อนุมัติคือ ESP32 38-pin / ESP-32D ใช้ GPIO34 แบบ input-only, active LOW และ external pull-up 10kΩ:

```text
3.3V → 10kΩ → GPIO34 → ปุ่ม NO → GND
```

ใช้ `pinMode(34, INPUT)` เท่านั้น ไม่ใช้ `INPUT_PULLUP`, 5V, EN หรือ BOOT/GPIO0 Debounce 50 ms, กดค้าง 5 วินาที และต้องปล่อยหลัง boot อย่างน้อย 2 วินาทีก่อน arm ใหม่

## Security limitation

ESP32 ต้องใช้ Setup Code แบบย้อนกลับได้เพื่อส่งให้ WPA2 soft AP ดังนั้น Phase 4 เก็บ Setup Code ใน NVS เดิมแบบ plaintext ไม่มี Flash/NVS encryption ตามขอบเขตที่อนุมัติ ต้องควบคุมการเข้าถึงอุปกรณ์จริงและปิด production hardening gate ใน Phase 5

## ขั้นตอนใช้งาน

1. ขณะกล่องออนไลน์ สร้างหรือเปลี่ยน Setup Code และจดรหัสที่แสดงครั้งเดียว
2. ปิดโต๊ะทุกโต๊ะผ่าน workflow ปกติจน Relay ทุกช่อง OFF
3. กด **โหมดกู้คืน Wi‑Fi** และยืนยัน
4. เชื่อมต่อ `Lucky-Relay-xxxxx` ด้วย Setup Code
5. เปิด `192.168.4.1`, กรอก Setup Code และเลือก Wi‑Fi ใหม่
6. รอ Portal แสดงว่าสำเร็จ แล้วกลับ Hardware Manager เพื่อค้นหากล่องอีกครั้ง
