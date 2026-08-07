# Phase 6 — Windows Application Packaging, Installer & Safe Update Foundation

Decision date: 2026-08-04  
Decision authority: User/OWNER instruction  
Status: `ARCHITECTURE APPROVED / INTERNAL IMPLEMENTATION UNBLOCKED / PRODUCTION DISTRIBUTION BLOCKED`

## Objective

สร้างฐานแอป Windows ที่ติดตั้งและกู้คืนได้อย่างปลอดภัย แยก Program files ออกจาก Customer data และเตรียม transaction สำหรับ update/rollback โดยไม่เริ่ม OTA, cloud update หรือ Production distribution

Phase 6 แบ่งเป็น:

- **6A — Electron shell and Program/Data separation**
- **6B — Internal test installer and lifecycle**
- **6C — Offline signed update foundation and rollback simulation**

แต่ละส่วนต้องหยุดรายงานผลก่อนเริ่มส่วนถัดไป Production release เป็น gate แยกและไม่ถูกอนุมัติจากเอกสารนี้

## Gate 1 — Platform and target: APPROVED

- Windows 11 x64 เป็น target หลัก
- Electron main process เป็นเจ้าของ app lifecycle และ User Data path
- Renderer ไม่มี direct Node.js/filesystem access
- ยังไม่รองรับ macOS/Linux ใน Phase นี้

## Gate 2 — Electron security baseline: APPROVED

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true` หาก compatibility test ผ่าน; หากต้องปิดต้องหยุดขออนุมัติ
- narrow preload API พร้อม allowlist
- validate sender, channel และ payload ทุก IPC
- ห้าม `remote`, `eval`, arbitrary navigation, arbitrary shell command และ arbitrary filesystem path
- CSP ต้องเริ่มจาก deny-by-default และอนุญาตเฉพาะ resource ที่จำเป็น

## Gate 3 — Program/Data separation: APPROVED

Program files:

```text
%ProgramFiles%\Lucky Snooker Manager\
```

Customer data:

```text
%LOCALAPPDATA%\Lucky Snooker Manager\
  database\
  backups\
  config\
  license\
  logs\
  uploads\
  update-staging\
```

- Program/update process ห้ามเขียนทับ Customer data
- Backend รับ resolved data root จาก trusted main process/environment เท่านั้น
- Browser/renderer ห้ามส่ง data path
- Test runtime ใช้ isolated temporary data root

## Gate 4 — Legacy data handoff: APPROVED

- Migration เป็น `copy → validate → backup → atomic activate`
- ไม่ลบหรือย้าย legacy data ต้นฉบับอัตโนมัติ
- ตรวจ schema, integrity, file hashes และ backup ก่อน activate
- หากกำกวม/เสียหายให้ fail closed พร้อม recovery ภาษาไทย
- migration ต้อง idempotent และมี marker version
- ห้าม migrate Device Key/plaintext secret ไปตำแหน่งใหม่โดยไม่มี secret-storage gate

## Gate 5 — Single instance and backend lifecycle: APPROVED

- ใช้ single-instance lock
- main process เริ่ม Backend หนึ่ง process และตรวจ readiness ก่อนเปิด UI
- graceful shutdown ต้องหยุด polling/timers และรอ atomic writes
- crash/restart ห้ามสร้าง Backend สองตัวใช้ data root เดียวกัน
- บันทึก PID/port เป็น runtime metadata ที่ไม่ใช่ credential

## Gate 6 — Network exposure: APPROVED WITH RESTRICTION

- Desktop UI ใช้ loopback เป็นค่าเริ่มต้น
- LAN mode เดิมต้องไม่ถูกเปิดกว้างขึ้นโดย Installer
- หากต้องรองรับเครื่องลูกข่าย ให้คง authentication/permissions และ Windows Firewall private-network rule แบบ explicit
- ห้าม public-network firewall rule และห้าม Internet exposure
- เปลี่ยน binding/firewall policy ต้องมี focused security acceptance

## Gate 7 — Installer privilege model: APPROVED

- Installer elevation ใช้เฉพาะติดตั้ง Program Files/shortcut/uninstall metadata
- แอปประจำวันรันเป็น standard user
- Installer ห้ามขอหรืออ่าน Device Key, Setup Code, Wi-Fi password หรือ Production signing key
- ห้ามติดตั้ง service/background auto-start โดยปริยาย
- Startup option ต้องเป็น explicit OWNER choice ในงานแยก

## Gate 8 — Installer scope and uninstall: APPROVED

- Internal test installer เท่านั้นใน Phase 6B
- ติดตั้ง/ซ่อม/อัปเกรด application files แบบ atomic เท่าที่ packaging tool รองรับ
- Uninstall ลบ Program files ได้ แต่เก็บ Customer data เป็นค่าเริ่มต้น
- การลบ Customer data ต้องเป็น separate explicit destructive workflow พร้อม backup
- ห้าม bundle firmware production package ที่ยังไม่ approved

## Gate 9 — Dependency and toolchain: CONDITIONALLY APPROVED

- ก่อนเพิ่ม Electron/packager ต้อง pin exact versions และบันทึก provenance/licenses
- ใช้ lockfile และ reproducible build command
- ห้าม postinstall ดาวน์โหลด executable โดยไม่บันทึก hash/provenance
- dependency/security/license review ต้องผ่านก่อนสร้าง distributable artifact
- การติดตั้ง dependency จาก Internet ต้องขออนุญาต execution แยกเมื่อเริ่ม implementation

## Gate 10 — Application package signing: APPROVED AS FAIL-CLOSED

- Production firmware signing key ใช้กับ Windows application ไม่ได้
- Windows Authenticode certificate: `NOT ACQUIRED`
- Production application/update signing key: `NOT CREATED/ENROLLED`
- Phase 6 ใช้ unsigned internal artifact หรือ ephemeral test signature พร้อมคำเตือนชัดเจนเท่านั้น
- ห้ามเรียก artifact ว่า Production-approved
- Production private keys ห้ามอยู่ใน repository, Browser, app runtime หรือ build logs

## Gate 11 — Update transaction foundation: APPROVED

ลำดับที่ล็อก:

```text
receive offline package
→ validate manifest/target/version/hash/signature
→ verified Customer Data backup
→ stage new Program files
→ graceful stop
→ activate staged version
→ migration runner (ถ้ามี)
→ smoke check
→ commit หรือ rollback
```

- Phase 6 ไม่ดาวน์โหลด update จาก Internet
- ห้าม OTA firmware และห้าม silent background update
- same-version/downgrade policy ต้อง fail closed ตาม SemVer contract
- updater ห้ามแก้ Customer data นอก migration runner

## Gate 12 — Rollback and recovery: APPROVED

- เก็บ previous application version จน smoke check ผ่าน
- migration failure ต้อง restore verified pre-migration backup
- power loss ทุก boundary ต้องกลับมาระบุ state และ retry/rollback ได้
- ห้ามสร้าง empty data store เมื่อ recovery ล้มเหลว
- recovery UI/logs ห้ามเปิดเผย secrets

## Gate 13 — Hardware and business isolation: APPROVED

- Phase 6 ห้ามเปลี่ยน Relay, GPIO, Firmware, Device Key, Setup Code, Wi-Fi หรือ Hardware mapping
- ห้ามเปลี่ยน Billing, POS, Products, Members, Reports, Reservations, Table Sessions, QR และ Backup semantics
- Hardware Manager/health polling ต้อง cleanup และ resume ตาม lifecycle เดิม
- Hardware flash จริงต้องมี approval แยก

## Gate 14 — Verification and acceptance: APPROVED

ขั้นต่ำ:

- focused Electron/main/preload/IPC tests
- path-boundary and traversal tests
- single-instance/backend lifecycle tests
- legacy copy/validate/rollback tests
- install/repair/upgrade/uninstall tests บน Windows test machine/VM
- power-loss simulation ที่ transaction boundaries
- secret scan, dependency/license inventory และ antivirus scan
- full regression ของระบบเดิม
- manual Windows acceptance ที่ 1366×768 และ 1920×1080

ห้ามอ้าง installer, antivirus, signature หรือ Windows acceptance ว่าผ่านจาก unit tests

## Gate 15 — Release authorization: PARTIALLY APPROVED

อนุมัติ:

```text
Phase 6A internal implementation: YES
Internal test artifacts: YES — clearly marked NOT FOR PRODUCTION
Production private key creation: NO
Production installer distribution: NO
Internet updater: NO
OTA: NO
Phase 7: NOT STARTED
```

Production distribution จะปลดได้เมื่อครบทุกข้อ:

- Production Key Ceremony/public-key enrollment
- Windows Authenticode decision/certificate
- legal and third-party distribution review
- antivirus acceptance
- clean Windows install/upgrade/uninstall acceptance
- CP210x และ CH340/CH341 driver acceptance หาก bundle/แนะนำ driver
- ESP32 hardware acceptance
- Backup/restore and migration acceptance
- OWNER + Production Approver sign-off

## Stop conditions

หยุดก่อน implementation และขออนุมัติใหม่ หากพบว่าต้อง:

- ปิด Electron sandbox/context isolation
- ส่ง filesystem/secret access ให้ renderer
- ลบหรือย้าย Customer data ต้นฉบับ
- เปิด public network/firewall
- สร้างหรือใช้ Production private key
- ดาวน์โหลด update จาก Internet
- เปลี่ยน Firmware/Relay/business logic
- เริ่ม Phase 7

## Approved implementation order

```text
Phase 6A architecture verification
→ pinned dependency/toolchain proposal
→ Electron shell security baseline
→ Program/Data path resolver
→ legacy copy/validate handoff
→ single-instance/backend lifecycle
→ focused tests + full regression + documentation
→ STOP AND REPORT
```

Phase 6B และ 6C ยังต้องได้รับรายงานผลและคำอนุมัติเริ่มแยกหลัง Phase 6A

## Decision summary

```text
Phase 6 Name: Windows Application Packaging, Installer & Safe Update Foundation
Architecture: APPROVED
Decision Gates: APPROVED WITH PRODUCTION RESTRICTIONS
Phase 6A Internal Implementation: UNBLOCKED
Phase 6B Internal Installer: GATED AFTER 6A
Phase 6C Offline Update Foundation: GATED AFTER 6B
Production Private Key: NOT CREATED
Production Distribution: BLOCKED
OTA/Internet Update: PROHIBITED
Hardware/Firmware Changes: PROHIBITED
Phase 7: NOT STARTED
```
