# Lucky Snooker Manager — Zero-code Wi-Fi Provisioning & Automatic Device Discovery

## Phase 1: Architecture and implementation plan

สถานะเอกสาร: **เสนอเพื่อขอตรวจสอบก่อน implementation**

เอกสารนี้เป็นผลจากการสำรวจ Hardware Manager, Hardware Setup Wizard, server-side driver/service/repository, รูปแบบข้อมูลที่ใช้งานจริง, Firmware, NVS, Authentication, Safe Boot, Relay Service และ tests ที่เกี่ยวข้อง โดย Phase 1 **ไม่มีการเปลี่ยนพฤติกรรมของระบบ**

## 1. ขอบเขตและ invariants

สิ่งที่เพิ่มใน Phase 2–5:

- ค้นหา Lucky Relay Controller โดยยึด `Device ID`
- ค้นหาตามลำดับ saved IP → mDNS → UDP → bounded subnet scan
- เปลี่ยน Wi-Fi ผ่าน authenticated API พร้อม candidate/commit/rollback
- Setup AP และ Setup Portal เมื่อเครือข่ายเดิมใช้ไม่ได้
- เชื่อม workflow ภาษาไทยเข้ากับ Hardware Manager และ Wizard

สิ่งที่ห้ามเปลี่ยน:

- Billing, POS, Products, Members, Reports, QR Payment และ Backup
- REST API v1 และพฤติกรรมเดิมของ relay
- GPIO mapping `13, 14, 16, 17, 18, 19, 25, 26`
- active-low semantics และ Safe Boot ซึ่งต้องเขียนทุก relay เป็น HIGH/OFF ก่อน NVS/Wi-Fi
- `X-Lucky-Device-Key` สำหรับ protected API เดิม
- Manual IP workflow ต้องยังใช้งานได้

## 2. โครงสร้างปัจจุบัน

### Application

```text
Hardware Manager / Setup Wizard (public/js/app.js)
  → Express routes (index.js)
  → HardwareSetupWizardService / HardwareService
  → RelayControllerDriver
  → ESP32 REST API v1

Persistent device data
  → HardwareRepository
  → data/hardware-devices.json (atomic JSON write)
```

- Hardware Manager จำกัดสิทธิ์ `OWNER` และ `ADMIN`
- `RelayControllerDriver` เป็น HAL ฝั่ง server และเป็นจุดเดียวที่ควรขยาย HTTP contract
- Wizard draft อยู่ในหน่วยความจำและล้าง secret เมื่อ cancel/complete
- `HardwareService.saveVerifiedSetup()` อัปเดต record เดิมด้วย `deviceId` และรักษา record ID/table mapping
- อุปกรณ์ถาวรเก็บใน `hardware-devices.json`; SQLite migration ที่มีอยู่ยังไม่ใช่ persistence path ของ Hardware
- API key ถูกตัดออกจาก response/log แต่ยังเก็บ plaintext at rest ตามระบบเดิม

### Firmware

```text
main
  ├─ ConfigService → StorageService → ESP32 Preferences/NVS
  ├─ WifiService → WiFi STA
  ├─ AuthService → X-Lucky-Device-Key
  ├─ RelayService → ArduinoGpioDriver
  ├─ HealthService
  └─ ApiServer → WebServer port 80
```

- `ConfigService` เป็นเจ้าของ configuration; `StorageService` เป็นโมดูลเดียวที่แตะ NVS
- `WifiService` ปัจจุบันรองรับ STA และ retry ทุก 10 วินาที แต่ไม่มี provisioning state
- `ApiServer` เป็น synchronous Arduino `WebServer`; handler ต้องสั้นและห้ามรอการเชื่อมต่อ Wi-Fi แบบ blocking
- ทุก POST เดิม authenticate ก่อน parse/mutation
- Safe Boot และ `RelayService::turnAllOff()` เป็น safety boundary ที่ห้ามอ่อนลง

## 3. Architecture ที่เสนอ

### 3.1 Application modules

เพิ่มแบบแยกส่วน:

```text
Hardware UI
  → Discovery routes / Wi-Fi provisioning routes
  → HardwareDiscoveryService
       ├─ SavedIpDiscovery
       ├─ MdnsDiscovery
       ├─ UdpDiscovery
       └─ SubnetDiscovery (fallback only)
  → HardwareProvisioningService
  → RelayControllerDriver (เพิ่ม API methods เท่านั้น)
  → HardwareRepository (atomic update by deviceId)
```

ข้อกำหนด:

- Discovery provider ทุกตัวคืน candidate รูปแบบเดียวกันและไม่มีสิทธิ์บันทึกข้อมูล
- `HardwareDiscoveryService` deduplicate ด้วย `deviceId`; IP เป็นเพียง address ปัจจุบัน
- ทุก candidate จาก mDNS/UDP/subnet ต้อง verify ด้วย `GET /health` และ `GET /device`
- การบันทึก IP ใหม่ทำผ่าน `HardwareService` หลัง `deviceId` ตรงกับอุปกรณ์ที่เลือกเท่านั้น
- จำกัด concurrency, timeout และ request budget ส่วนกลาง ห้ามให้ UI สร้าง subnet scan เอง
- Manual IP ใช้ driver และ verification path เดียวกับ discovery

### 3.2 Firmware modules

เพิ่มโดยไม่รวมเข้ากับ Relay Service:

```text
ConfigService
  └─ WiFi credential slots + provisioning metadata in NVS

WifiProvisioningService
  ├─ scan networks
  ├─ stage candidate
  ├─ asynchronous connection state machine
  ├─ commit candidate
  └─ rollback to confirmed credentials

DiscoveryService
  ├─ mDNS hostname
  └─ authenticated-neutral UDP advertisement

SetupModeService
  ├─ physical-button / connection-timeout trigger
  ├─ AP lifecycle and expiry
  ├─ setup session + proof-of-possession
  └─ captive Setup Portal

ApiServer
  └─ thin HTTP adapters to the services above
```

`loop()` เรียก service เหล่านี้แบบ non-blocking ทุก iteration และยัง feed watchdog ตามเดิม

## 4. Device identity และ discovery

### Identity rule

- Canonical identity: `deviceId`
- Network locator: IPv4/hostname
- Display identity: `deviceName`
- ห้าม merge หรือ overwrite record โดยอาศัย IP อย่างเดียว
- `deviceId` ต้องไม่ว่าง, มีความยาวจำกัด และตรงกันระหว่าง `/health`, `/device` และผล verify หลัง discovery

หมายเหตุ: ค่าเริ่มต้น `LRC-0001` แบบคงที่ไม่ปลอดภัยสำหรับหลายกล่อง ใน Phase 2 ต้องเพิ่ม migration ให้กล่องที่ยังใช้ default ID สร้าง stable unique ID จาก random/ESP32 hardware identity แล้วบันทึก NVS ครั้งเดียว โดยห้ามเปลี่ยน ID ของกล่องที่มี unique ID อยู่แล้ว

### Discovery order

1. Saved IP: probe IP ล่าสุดของ record เป้าหมาย
2. mDNS: resolve `lucky-relay-<suffix>.local`
3. UDP: broadcast request และรวบรวม response ในหน้าต่างเวลาจำกัด
4. Subnet scan: fallback เมื่อสามวิธีแรกไม่สำเร็จ

ค่าตั้งต้นที่เสนอ:

- per-request HTTP timeout: 1,500 ms สำหรับ discovery; verification ปลายทางใช้ได้ถึง 3,000 ms
- UDP collection window: 1,500 ms และ retry 1 ครั้ง
- subnet scan concurrency: 16
- subnet scan เฉพาะ private IPv4 subnet ของ active interface และสูงสุด `/24`
- overall discovery budget: 15 วินาที
- deduplicate response ด้วย `deviceId`; candidate เดียวกันหลาย IP ให้ verify แล้วเลือก IP ที่ตอบสำเร็จล่าสุด

### UDP contract

Request:

```json
{
  "protocol": "lucky-relay-discovery",
  "protocolVersion": 1,
  "type": "discover"
}
```

Response:

```json
{
  "protocol": "lucky-relay-discovery",
  "protocolVersion": 1,
  "type": "announce",
  "deviceId": "LRC-...",
  "deviceName": "กล่องควบคุมโซนหลัก",
  "ip": "192.168.1.50",
  "apiPort": 80,
  "apiVersion": "1",
  "firmwareVersion": "1.1.0"
}
```

UDP response ไม่ถือเป็น trusted identity และไม่มี Device Key; server ต้อง verify REST contract และ `deviceId` ก่อนใช้เสมอ

## 5. Wi-Fi provisioning API contract

REST API เดิมทั้งหมดคงเดิม เพิ่ม API v1 ต่อไปนี้:

### `GET /api/v1/wifi/status`

Public field เฉพาะข้อมูลที่ไม่ลับ:

```json
{
  "success": true,
  "state": "CONNECTED",
  "connected": true,
  "ssid": "Shop-WiFi",
  "ip": "192.168.1.50",
  "rssi": -55,
  "setupMode": false,
  "provisioningId": null
}
```

ห้ามคืน password, candidate password หรือ Device Key

### `POST /api/v1/wifi/scan`

- ต้องใช้ `X-Lucky-Device-Key`
- เริ่ม scan แบบ asynchronous และคืน `operationId`
- `GET /api/v1/wifi/scan/{operationId}` คืน SSID, RSSI และ security type เท่านั้น
- deduplicate SSID และจำกัดจำนวนผลลัพธ์/payload

### `POST /api/v1/wifi/provision`

ต้องใช้ `X-Lucky-Device-Key`

```json
{
  "ssid": "New-Shop-WiFi",
  "password": "<secret>",
  "expectedDeviceId": "LRC-...",
  "clientNonce": "<random>"
}
```

Response:

```json
{
  "success": true,
  "provisioningId": "<opaque-id>",
  "state": "CANDIDATE_STAGED",
  "deviceId": "LRC-..."
}
```

ข้อกำหนด:

- validate `expectedDeviceId` ก่อน mutation
- SSID 1–32 bytes; password ตาม security type และสูงสุด 63 bytes
- ห้าม log request body
- stage candidate ลง NVS แยกจาก confirmed credentials
- relay ทุกช่อง OFF ก่อนเริ่ม transition
- handler คืนทันที; state machine ทำงานใน `loop()`

### `GET /api/v1/wifi/provision/{provisioningId}`

คืนสถานะที่ไม่ลับ:

`CANDIDATE_STAGED`, `CONNECTING_CANDIDATE`, `CANDIDATE_CONNECTED`, `COMMITTED`, `ROLLING_BACK`, `ROLLED_BACK`, `FAILED`

### `POST /api/v1/wifi/provision/{provisioningId}/commit`

- ต้อง authenticate
- ใช้ได้เมื่อ candidate เชื่อมต่อและ server พบอุปกรณ์ใหม่ด้วย `deviceId` เดิม
- commit candidate เป็น confirmed credentials แล้วลบ candidate slot
- idempotent: commit ซ้ำของ operation เดิมต้องคืนผลเดิม

### `POST /api/v1/wifi/provision/{provisioningId}/rollback`

- ต้อง authenticate
- relay OFF, restore confirmed credentials, ลบ candidate slot และ reconnect
- idempotent

เนื่องจาก backend อาจติดต่อ IP เดิมไม่ได้หลัง transition การยืนยัน candidate ต้องใช้ discovery ที่หา `deviceId` เดิมเจอจากเครือข่ายใหม่ แล้วจึงเรียก commit ที่ IP ใหม่ หากหมดเวลาหรือ server หายไป Firmware ต้อง rollback เอง

## 6. Provisioning state machine

```text
CONFIRMED_CONNECTED
  → CANDIDATE_STAGED
  → RELAYS_SAFE_OFF
  → CONNECTING_CANDIDATE
      ├─ connected → AWAITING_COMMIT
      │                ├─ commit → CONFIRMED_CONNECTED
      │                └─ timeout/reboot → ROLLING_BACK
      └─ failed/timeout → ROLLING_BACK
                           → CONFIRMED_CONNECTING
                           → ROLLED_BACK
```

กฎ recovery:

- confirmed credentials ห้ามถูก overwrite ก่อน commit
- NVS มี `provisioningState`, opaque operation ID, candidate credentials, deadline/attempt counter และ confirmed credentials
- boot ระหว่าง state ที่ไม่ใช่ committed ต้อง relay OFF ก่อน แล้ว rollback ไป confirmed configuration
- ถ้า rollback network ก็ใช้ไม่ได้ ให้เข้า Setup Mode หลัง connection timeout
- การ crash/reboot ห้ามทำให้ candidate กลายเป็น confirmed โดยอัตโนมัติ

## 7. Setup Mode และ Setup Portal

### Entry

- Auto: เชื่อม confirmed Wi-Fi ไม่สำเร็จต่อเนื่อง 60 วินาที
- Physical: กดปุ่ม Setup ค้าง 5 วินาทีพร้อม debounce และ boot/runtime guard
- การเข้า Setup Mode ไม่ใช่ Factory Reset
- GPIO ของปุ่มต้องเลือกหลังตรวจ schematic/board จริง และต้องไม่ชน relay mapping

### AP

- SSID: `Lucky-Relay-XXXX`
- Gateway: `192.168.4.1`
- relay ทุกช่อง OFF ตลอด Setup Mode
- หมดอายุเริ่มต้น 10 นาที; ต่ออายุได้เฉพาะเมื่อมี authenticated setup session
- AP ควรใช้ WPA2 password หรือ setup PIN ที่สุ่ม/ผูกกับฉลากบนกล่อง

### Portal security

- proof-of-possession: setup PIN ต่อกล่อง เก็บ verifier ใน NVS; ไม่ใช้ Device Key เป็นค่าที่แสดงใน portal
- เมื่อ PIN ถูกต้อง ออก short-lived setup session cookie แบบ HttpOnly/SameSite=Strict
- ทุก mutation ต้องมี CSRF token ผูกกับ session
- rate limit PIN attempts และ lockout ชั่วคราว
- allowlist Host/Origin สำหรับ `192.168.4.1` และ portal hostname
- `Cache-Control: no-store`; ห้าม third-party assets
- validate payload ด้วย fixed-length buffers; ไม่มี shell/command execution
- log เฉพาะ event/result ห้าม log PIN/SSID password/body

Portal ใช้ API namespace แยก เช่น `/setup/api/v1/*` และเปิดเฉพาะ Setup Mode เพื่อไม่ขยายสิทธิ์ของ REST API ปกติ

## 8. Application workflow

```text
Hardware Manager
  → ตั้งค่ากล่องควบคุม
  → ค้นหากล่องอัตโนมัติ
  → เลือกกล่อง (แสดง Device ID ท้าย 4 ตัว)
  → ตรวจสอบ health/device
  → ยืนยัน Device Key
  → เลือก:
       ├─ บันทึก/ทดสอบ Relay ตาม Wizard เดิม
       └─ เปลี่ยนเครือข่าย Wi-Fi
            → scan → เลือก SSID → ใส่ password
            → stage → ค้นหา Device ID เดิมอีกครั้ง
            → verify auth → commit → update IP
```

หากค้นหาไม่พบ ต้องแสดง:

- ตรวจว่าเปิดกล่องแล้ว
- ค้นหาอีกครั้ง
- ตั้งค่า Wi-Fi ให้กล่องผ่าน Setup AP
- กรอก IP ด้วยตนเอง
- เปิดคำแนะนำแก้ปัญหา

UI ต้องแสดงสถานะ provisioning ทั้งหมดเป็นภาษาไทยและไม่แสดงคำว่า mDNS/UDP/subnet เว้นแต่ในรายละเอียดสำหรับผู้ดูแล

## 9. Persistence และ migration strategy

### Application data

คง `hardware-devices.json` เพื่อ backward compatibility ในระยะนี้ และเพิ่ม field แบบ additive:

```json
{
  "deviceId": "LRC-...",
  "ipAddress": "192.168.1.50",
  "mdnsHostname": "lucky-relay-ab12.local",
  "discoveryProtocolVersion": 1,
  "lastDiscoveryMethod": "UDP",
  "lastDiscoveredAt": "ISO-8601",
  "lastNetworkChangeAt": "ISO-8601"
}
```

- repository load ต้อง normalize record เก่าโดยไม่เขียนทับทันที
- save ใช้ atomic writer เดิม
- update IP ต้อง compare `deviceId` และรักษา `id`, mapping, relay test metadata และ API key
- duplicate `deviceId` ต้อง fail closed และให้ผู้ใช้เลือกแก้ ไม่ merge เงียบ
- SQLite schema ไม่ต้องแก้ใน Phase 2 เว้นแต่โปรเจกต์ย้าย Hardware persistence ไป SQLite อย่างเป็นทางการ

### Firmware NVS

เพิ่ม key แบบ additive และ versioned:

- `configVersion`
- confirmed Wi-Fi slot
- candidate Wi-Fi slot
- `provisionState`, `provisionId`, attempts/deadline metadata
- stable unique `deviceId` migration marker
- setup PIN verifier/setup security metadata

ห้ามเรียก `Preferences.clear()` ใน Setup Mode หรือ Wi-Fi provisioning เพราะจะลบ Device ID, Device Key, relay count และข้อมูลสำคัญอื่น

## 10. Security model

Threat boundaries:

- LAN packets/mDNS/UDP เป็น untrusted input
- Browser ติดต่อเฉพาะ Lucky server; server เป็นผู้ติดต่อ ESP32
- Device Key ใช้พิสูจน์สิทธิ์ควบคุมอุปกรณ์ แต่ UDP advertisement ไม่ใช่ authentication
- Setup Portal ต้องใช้ physical proximity + proof-of-possession + short-lived session

Controls:

- role guard `OWNER/ADMIN` เดิมกับ discovery/provision routes ทุก route
- expected `deviceId` ในทุก mutation ที่เปลี่ยน network
- bounded input, timeout, concurrency, response size และ scan scope
- redaction middleware/test สำหรับ `apiKey`, `password`, PIN และ candidate credentials
- structured audit ที่มี actor, deviceId, outcome และ discovery method แต่ไม่มี secret
- rate limit authentication/provision/setup endpoints
- relay OFF ตลอด network transition, Setup Mode และ recovery

ประเด็นต้องแก้ก่อน production:

- bootstrap Wi-Fi password และ Device Key ปัจจุบันฝังอยู่ใน source file; ต้อง rotate credential ที่ใช้งานจริง และเปลี่ยน build/release process ให้รับ secret จาก private build environment หรือ first-boot provisioning
- `hardware-devices.json` เก็บ Device Key แบบ plaintext; Phase 3 ควรเพิ่ม encrypted-at-rest secret store โดยอ่านข้อมูลรูปแบบเดิมได้และ migrate แบบ atomic
- HTTP บน LAN ไม่มี transport encryption; หลีกเลี่ยงการส่ง secret ซ้ำ, จำกัด trusted LAN และวางแผน application-layer challenge/encryption หาก threat model ต้องรองรับ hostile LAN

## 11. Test plan

### Application unit

- provider order, timeout และ overall budget
- discovery: 0/1/หลายอุปกรณ์, duplicate packet, malformed/oversized packet
- wrong protocol/version, missing fields, invalid IP/port
- same Device ID at new IP; different Device ID at saved IP
- multiple interfaces/private subnet selection และ bounded concurrency
- no persistence before REST verification
- atomic update by Device ID preserving mappings
- password/Device Key/PIN never present in logs, errors, responses or snapshots

### Application integration

- mDNS → REST verify
- UDP → REST verify
- saved IP failure → fallback provider
- provision success → rediscover same Device ID → auth → commit → IP update
- wrong Wi-Fi password → Firmware rollback → old IP/identity retained
- server crash/restart during provisioning
- duplicate user request/idempotency
- manual IP fallback remains functional
- role authorization and feature flags

### Firmware native/component

- candidate/confirmed config state transitions
- NVS write failure at every transition
- reboot at every provisioning state
- wrong password/connect timeout/rollback
- relay safe state before and throughout transition
- automatic and physical Setup Mode entry
- button debounce/long press/no collision with relay pins
- setup expiry, PIN lockout, CSRF and malformed payload
- Wi-Fi/password/PIN never logged
- stable Device ID migration and preservation
- discovery packet exact contract and size bound

### Regression and build gates

- `npm test`
- `npm run check`
- all Sprint 11A/12A tests
- PlatformIO native tests
- ESP32 release build
- existing firmware contract tests
- manual Hardware Setup Wizard from start to finish

### Real ESP32 acceptance

1. saved IP, mDNS, UDP และ fallback discovery
2. หลายกล่องใน subnet เดียวกันและเลือกด้วย Device ID
3. DHCP เปลี่ยน IP หลัง reboot
4. เปลี่ยน Wi-Fi สำเร็จและ Hardware record อัปเดตเอง
5. password ผิดและกลับเครือข่ายเดิม
6. ถอดไฟระหว่าง stage/connect/awaiting commit/commit
7. ปิด server ระหว่าง transition
8. Router เดิมหาย → Setup AP → Portal → Router ใหม่
9. Setup button, timeout และ expiry
10. ตรวจ relay ทุกช่องเป็น OFF ระหว่าง provisioning/reboot

## 12. Phase plan และ rollback

### Phase 2 — Device discovery

- Firmware: stable unique Device ID migration, mDNS, UDP discovery
- Server: discovery providers/orchestrator, verified results, IP update by Device ID
- UI: automatic search + manual IP fallback
- Feature flags แยก `hardware.discoveryEnabled`

Rollback: ปิด flag แล้วใช้ Manual IP/Hardware Manager เดิม ข้อมูล record เดิมยังอ่านได้

### Phase 3 — Authenticated Wi-Fi change

- candidate/confirmed NVS model และ non-blocking provisioning state machine
- authenticated scan/stage/status/commit/rollback APIs
- server orchestration และ rediscovery
- encrypted-at-rest application secret migration
- Feature flag `hardware.wifiProvisioningEnabled`

Rollback: ปิด flag; Firmware ยังใช้ confirmed slot และ API/relay เดิม

### Phase 4 — Setup AP/Portal

- physical button หลังยืนยัน GPIO จริง
- AP lifecycle, proof-of-possession, portal security และ captive UX
- automatic entry เมื่อ confirmed network ใช้ไม่ได้
- Feature flag/build flag ฝั่ง Firmware

Rollback: disable Setup Mode entry; confirmed Wi-Fi และ relay API เดิมไม่เปลี่ยน

### Phase 5 — Integration, regression, documentation

- รวม flow ภาษาไทยเข้ากับ Hardware Manager/Wizard
- diagnostics, audit, complete test matrix และคู่มือภาษาไทย
- rollout แบบ opt-in ต่อกล่องก่อนเปิด default

## 13. ความเสี่ยงที่ยังเหลือและ decision gates

ต้องยืนยันก่อนเริ่ม implementation:

1. GPIO ของปุ่ม Setup และ hardware pull-up/down จากบอร์ดจริง
2. วิธีแจก setup PIN/unique Device ID ต่อกล่องในกระบวนการผลิตหรือ first boot
3. พฤติกรรม ESP32/Arduino Wi-Fi เมื่อสลับ AP จริงและเวลาที่เหมาะสมสำหรับ rollback
4. library สำหรับ mDNS/UDP/captive portal ที่เข้ากับ PlatformIO lock ปัจจุบัน
5. secret encryption key source บน Windows สำหรับ `hardware-devices.json`
6. subnet scan policy กรณีเครื่องมีหลาย network adapter/VPN
7. Setup AP timeout และจำนวน PIN attempts ที่ยอมรับได้ในการใช้งานร้านจริง

## 14. จุดที่จะเปลี่ยนในแต่ละ Phase

คาดว่าจะเพิ่ม/แก้เฉพาะพื้นที่ต่อไปนี้:

- Server: `drivers/`, `services/`, `repositories/hardware-repository.js`, hardware routes ใน `index.js`
- UI: Hardware Manager/Wizard block ใน `public/js/app.js` และ CSS ที่เกี่ยวข้อง
- Firmware: `config`, `storage`, `wifi`, `api` และโมดูลใหม่ `discovery`, `provisioning`, `setup`
- Tests: Sprint-specific application/firmware tests
- Docs: คู่มือ discovery, Wi-Fi change, Router replacement, Setup Mode, recovery, security และ troubleshooting

ไม่แตะ Billing, POS, Products, Members, Reports, QR Payment, Backup, GPIO mapping หรือ relay logic เดิม
