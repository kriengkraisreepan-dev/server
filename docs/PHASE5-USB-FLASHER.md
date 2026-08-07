# Phase 5 — One-click USB Flasher

## Safety boundary

USB flashing is available only to OWNER/ADMIN from a browser running on the backend computer. Requests from another LAN computer are rejected. The server accepts a COM port and a fixed mode only; executable paths, firmware paths, offsets, shell commands, and command arguments never come from the browser.

Before flashing, close every table through the normal workflow, confirm every relay is off, disconnect mains loads from the relay board, and then connect USB. The flasher never issues an automatic all-off command.

## Existing-device update (default)

The package signature and every SHA-256 digest are verified first. The target must pass `chip_id` as classic ESP32 and report 4 MB flash. Update mode writes only `firmware.bin` at `0x10000`. It never invokes `erase_flash` and never writes the partition table or NVS, preserving Device ID, Device Key, Setup Code, confirmed Wi-Fi, relay count, and mapping.

## New install

New install is explicitly selected and requires the exact second confirmation `ERASE NEW DEVICE`. Its signed manifest must declare bootloader `0x1000`, partition table `0x8000`, and application `0x10000`. A separately approved self-contained NVS generator must create a per-device image at `0x9000` containing a CSPRNG Device Key (at least 32 bytes) and Base31 Setup Code. No shared bootstrap Wi-Fi or shared bootstrap key is permitted.

## Transactional Enrollment Handoff

หลัง New Install สำเร็จ operation อยู่ที่ `ENROLLMENT_PENDING` และเก็บ Device Key เฉพาะในหน่วยความจำของ Backend ผู้ใช้เห็น Setup Code ตาม one-time policy แต่ไม่เห็นหรือกรอก Device Key กด **ดำเนินการตั้งค่ากล่องต่อ** หลังตั้ง Wi-Fi ผ่าน Setup Portal แล้ว Backend จะค้นหา Device ID จริง ตรวจ nonce/HMAC ด้วย pending key ตรวจ Firmware version และ Relay Count ก่อนสร้าง Hardware record ใหม่แบบ atomic จากนั้นล้าง pending key และเปิด Hardware Setup Wizard ที่ขั้นหลัง authentication

Handoff ผูกกับ Flash operation ID, OWNER/ADMIN คนเดิม, loopback machine, COM Port, Relay Count, release channel, expiration และ token แบบ single-use Browser ส่งได้เฉพาะ enrollment token ใน header และส่ง Device Key, Device ID, record ID, NVS path หรือ COM Port เพื่อเปลี่ยนเป้าหมายไม่ได้ Device ID ซ้ำจะ fail closed และไม่มีการเขียนทับ record หรือ table mapping เดิม

หาก discovery หรือ verification timeout ให้กดดำเนินการต่ออีกครั้ง ระบบใช้ pending key เดิมและไม่ Flash ซ้ำ หากบันทึกไม่สำเร็จจะไม่มี record ครึ่งหนึ่งและ pending key ยังอยู่สำหรับ retry

### Recovery และ Server restart

ห้ามปิด Server ระหว่าง `ENROLLMENT_PENDING` เพราะยังไม่มี DPAPI/secret store หากเพียงปิดหน้าต่าง ให้กลับ Hardware Manager แล้วกดเมนู USB Flasher ระบบจะแสดง operation ที่ยังอยู่ใน process และให้ retry โดยไม่เปิดเผย key

หาก Server restart หรือ enrollment หมดอายุ pending key จะหายแบบ fail closed และกู้ค่าเดิมไม่ได้ สำหรับ Test Hardware ให้ตรวจว่าไม่มีโหลดไฟบ้านและเริ่ม New Install ใหม่ด้วยตนเองตามขั้นตอนอนุมัติเดิม ห้ามระบบสร้าง key ใหม่หรือสั่ง Flash ซ้ำอัตโนมัติ Production recovery ต้องรอ secret-store hardening ที่แยกขอบเขตออกไป

At present this path fails closed with `NVS_GENERATOR_UNAVAILABLE` until the reviewed generator is bundled. It must not be replaced by a dependency on Python or PlatformIO.

## Package contract

The portable release places approved assets under `resources/usb-flasher`:

```
manifest.json
firmware/bootloader.bin
firmware/partitions.bin
firmware/firmware.bin
tools/esptool.exe
tools/nvs-generator.exe
keys/firmware-release-public.pem
THIRD-PARTY-NOTICES.txt
licenses/esptool-GPL-2.0-or-later.txt
```

The Ed25519 private key stays outside the repository, shop computer, and portable package. Tests use ephemeral test keys. Missing keys, files, signatures, or hash mismatches stop before any flasher process starts.

The production package must bundle a pinned official esptool 4.x standalone executable, its SHA-256, license, copyright notices, version, source location, and corresponding-source information. Distribution license compliance requires a separate release review.

## COM and driver policy

Windows CIM/PnP metadata lists ports. CP210x and CH340/CH341 VID/PID values are hints only. If multiple ports exist the user selects one; the program never picks automatically. Every port must independently pass esptool chip and flash checks. Phase 5 rejects ESP32-S2, S3, C3, C6, unknown targets, and non-4-MB flash.

Drivers are not installed automatically and the program does not request Administrator privileges. When a driver is missing, use the official Silicon Labs or WCH instructions.

## Logs and secrets

Portable logs are retained for 30 days in `data/logs/usb-flasher`. Only operational fields are allowlisted. Device Key, Setup Code, Wi-Fi password, raw NVS, cookies, and secret-bearing command lines are prohibited. Diagnostic exports must redact serial numbers and MAC addresses.

## Acceptance still required

- Supply and review the self-contained NVS generator and its license.
- Produce an externally signed production manifest and install only its public key.
- Acceptance-test the pinned esptool 4.x standalone binary on CP210x and CH340/CH341 boards.
- Verify update preserves NVS on a real controller.
- Verify power loss/recovery during each write stage.
- Verify first-install enrollment and one-time Setup Code handling end to end.

Phase 6 installer, OTA, Factory Reset, and internet firmware download remain out of scope.
