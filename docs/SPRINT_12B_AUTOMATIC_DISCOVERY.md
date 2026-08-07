# Sprint 12B — Automatic Device Discovery

## Architecture ที่ใช้จริง

```text
Hardware Manager / Setup Wizard
  → POST/GET/DELETE /api/hardware/discovery/*
  → HardwareDiscoveryService
       1. Saved IP
       2. mDNS
       3. UDP broadcast
       4. bounded /24 subnet fallback
  → RelayControllerDriver public GET verification
  → HardwareService.updateDiscoveredLocation()
  → HardwareRepository atomic JSON persistence

ESP32
  → ConfigService: stable eFuse-derived Device ID + legacy alias in NVS
  → DiscoveryService: mDNS + UDP 42101
```

Discovery results are untrusted until `/health`, `/device`, `/config/relay`, and `/relays` all pass the existing Firmware contract.

## Contract

- mDNS hostname: `lucky-relay-xxxx.local`
- mDNS service: `_lucky-relay._tcp.local`, port 80
- UDP port: 42101
- UDP maximum request: 512 bytes
- request type: `discover`
- response type: `announce`
- Device Key and Wi-Fi credentials are never present

See `firmware/docs/DISCOVERY.md` for the complete packet contract.

## Device ID migration

- Missing Device ID: initialize `LRC-XXXXXXXXXXXX` from eFuse MAC
- Stored non-default ID: preserve unchanged
- Legacy `LRC-0001`: persist the new ID and `previousDeviceId`
- Discovery never migrates a legacy record automatically
- Wizard requires explicit user confirmation and a fresh nonce/HMAC Device Key proof
- Final save migrates only when exactly one matching legacy record exists; IP may have changed
- Ambiguous legacy records fail closed
- Existing internal record ID, Device Key, relay test metadata, and table mapping are preserved

## Backend limits

- verification timeout: 1,500 ms
- UDP window: 1,500 ms, two attempts
- overall session timeout: 15 seconds
- subnet scope: active IPv4 interfaces, maximum one `/24` per interface
- subnet concurrency: 16
- subnet lightweight probe timeout: 450 ms
- discovery session retention: five minutes after completion
- maximum accepted UDP responses per adapter run: 64

## UX

- เพิ่มปุ่ม **ค้นหากล่องอัตโนมัติ** ใน Hardware Manager
- Wizard ขั้นค้นหามีทั้ง **ค้นหาอัตโนมัติ** และช่อง Manual IP เดิม
- ผลลัพธ์แสดงชื่อ, Device ID, IP, Firmware, Relay count และ RSSI
- รองรับหนึ่งกล่องหรือหลายกล่องโดยให้ผู้ใช้เลือก
- กล่องเดิมที่ IP เปลี่ยนได้รับการอัปเดตหลัง Device ID verification
- กล่องใหม่ไม่ถูกบันทึกอัตโนมัติและต้องดำเนิน Wizard

## Security

- routes จำกัดสิทธิ์ OWNER/ADMIN
- discovery เรียกเฉพาะ public GET และไม่มี protected POST
- UDP/mDNS metadata ไม่ถือเป็น authentication
- ทุก field จาก network ถูกจำกัดและตรวจรูปแบบ
- ไม่มี credential ใน packet, result, error หรือ structured log
- discovery ไม่มีสิทธิ์เปลี่ยน relay
- feature flag: `settings.hardware.discoveryEnabled`

## Automated verification

ผลล่าสุด:

- `npm run check`: ผ่าน
- `npm test`: 104/104 ผ่าน
- Focused discovery/migration/security tests: 35/35 ผ่าน
- `pio run -e esp32dev`: SUCCESS
  - RAM 47,608 / 327,680 bytes (14.5%)
  - Flash 825,521 / 1,310,720 bytes (63.0%)
- `pio test -e native`: ยังรันไม่ได้บนเครื่องนี้ เพราะไม่มี host `gcc/g++`

Firmware contract, stable identity, lifecycle, relay non-mutation, multiple devices, duplicate/spoofed packets, timeout, cancellation, bounded concurrency, legacy migration, key/mapping preservation, UI fallback และ permission boundary มี automated tests แล้ว

## ESP32 acceptance test

ยังต้อง flash Firmware 1.1 ลงกล่องจริงก่อน:

1. ถอดโหลดไฟบ้านออกจาก relay
2. Flash `firmware/.pio/build/esp32dev/firmware.bin`
3. เปิด Serial Monitor และยืนยัน `DEVICE_ID_MIGRATED`, `MDNS_STARTED`, `UDP_DISCOVERY_STARTED`
4. ตรวจ `/api/v1/health` และ `/api/v1/device`
5. เปิด Hardware Manager แล้วกดค้นหาโดยไม่กรอก IP
6. reboot กล่องและค้นหาใหม่
7. เปลี่ยน DHCP lease แล้วตรวจว่า record ID/mapping เดิมอยู่ครบ
8. ทดสอบสองกล่องและอุปกรณ์ HTTP ที่ไม่ใช่ Lucky
9. ตรวจทุก relay ยังคง OFF ระหว่าง discovery
10. ดำเนิน Wizard และ Manual IP fallback จนจบ
11. ตรวจ operational log ว่าไม่มี Device Key/Wi-Fi credential

## สิ่งที่เลื่อนไป Phase 3/4

- เปลี่ยน Wi-Fi และ candidate/commit/rollback
- Setup AP และ Captive Portal
- physical setup button
- USB Flasher
- OTA
- encrypted-at-rest Device Key migration

## ข้อจำกัด

- mDNS/UDP โดยทั่วไปไม่ข้าม VLAN, Router, guest network หรือ Client Isolation
- native Firmware tests ต้องมี host C++ compiler
- Hardware acceptance ยังไม่ถือว่าผ่านจนกว่าจะ flash และทดสอบ ESP32 จริง
