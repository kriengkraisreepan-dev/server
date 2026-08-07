# Next Work — Decision Gates

สถานะ: `SUPERSEDED BY PHASE6_DECISION_GATES.md — 2026-08-04`

Phase 5.4B ปิดแล้ว และ Phase 6 ใช้ Decision Gates ที่อนุมัติใน `docs/PHASE6_DECISION_GATES.md` เอกสารนี้คงไว้เป็น checklist ทั่วไปและประวัติการตัดสินใจ

## Gate 1 — Scope and phase identity

- ระบุชื่อ Phase, เป้าหมาย, user problem และสิ่งส่งมอบ
- แยก defect/maintenance ออกจาก feature ใหม่
- ระบุ out-of-scope และ stop condition
- ต้องได้รับคำอนุมัติชัดเจนก่อนแก้โค้ด

## Gate 2 — Phase 5.4A residual acceptance

- Manual Browser Acceptance: `COMPLETE — user attestation 2026-08-04`
- Defect ระดับ Critical/High ต้องปิดก่อน feature ที่พึ่งพา UI เดิม

## Gate 3 — Business-system isolation

- ยืนยันว่าจะไม่เปลี่ยน Billing, POS, Products, Members, Reports, Reservations, Table Sessions, QR Payment หรือ Backup เว้นแต่ระบุใน scope
- ระบุ regression suites ที่ต้องปกป้อง

## Gate 4 — Hardware and relay safety

- ระบุว่าแตะ Hardware Manager, discovery, Wi-Fi, Setup AP, USB Flasher หรือ Firmware หรือไม่
- หากแตะ ต้องกำหนด relay-off policy, fail-closed behavior และ hardware acceptance แยกต่างหาก
- ห้ามเปลี่ยน Relay อัตโนมัติเพื่ออำนวยความสะดวกแก่ setup flow

## Gate 5 — Security and secrets

- ระบุข้อมูลลับที่เกี่ยวข้อง, storage boundary, logging/redaction และ authorization
- Browser ต้องไม่รับ Device Key, signing key หรือ credential material
- ไม่มี dependency/internet service ใหม่หากยังไม่อนุมัติ

## Gate 6 — Production signing boundary

- Production private key ยังคง `NOT CREATED`
- Production public-key enrollment ยังคง `PENDING`
- ห้ามสร้าง Production-approved package จนกว่าจะผ่าน Key Ceremony และ two-role approval
- งานถัดไปต้องระบุชัดว่าไม่เปลี่ยน manifest/release-package contract หรือขออนุมัติแยก

## Gate 7 — Data and migration

- ระบุ schema/storage changes, atomicity, backup/rollback และ legacy compatibility
- หากไม่มี data change ต้องล็อกเป็น `NONE`

## Gate 8 — API and permissions

- ระบุ endpoint ใหม่/เปลี่ยน, actor roles, CSRF/session policy และ compatibility
- ห้ามเปลี่ยน permission matrix โดยปริยาย

## Gate 9 — UX and accessibility

- ระบุ Browser/resolution targets, keyboard/focus, contrast, modal/overflow และ print impact
- Display Preferences ของ Phase 5.4A ต้องยังทำงานครบทุก theme/scale

## Gate 10 — Failure, recovery and observability

- ระบุ timeout, retry, rollback, restart/power-loss behavior และข้อความภาษาไทย
- Logs ต้องมีข้อมูลวินิจฉัยโดยไม่มี secrets

## Gate 11 — Test strategy

- กำหนด focused tests, full regression baseline, syntax/static checks และ manual acceptance
- Firmware build ทำเมื่อ Firmware เปลี่ยนเท่านั้น
- Hardware flash ต้องมี approval และ safety checklist แยก

## Gate 12 — Rollback

- ระบุไฟล์/feature flag/data rollback และเงื่อนไขหยุดใช้งาน
- ห้ามใช้ rollback ที่ลบข้อมูลธุรกิจหรือ credentials แบบกว้าง

## Gate 13 — Release and distribution

- ระบุ test/production channel, artifact classification และ distribution approval
- Production distribution ยังคง blocked จนกว่าจะผ่าน legal/AV/Windows/driver/hardware/approver gates เดิม

## Gate 14 — Acceptance evidence

- ระบุหลักฐานที่ต้องส่ง: test counts, build hash (ถ้ามี), screenshots/manual matrix, changed files และ residual risks
- ห้ามอ้าง visual/hardware acceptance จาก automated tests

## Gate 15 — Explicit authorization

ต้องมีข้อความอนุมัติค่าที่ล็อกทั้งหมดและระบุว่าเริ่ม implementation ได้ ก่อน Gate นี้สถานะต้องเป็น:

```text
Next Phase Architecture: PREPARED
Decision Gates: PENDING APPROVAL
Implementation: NOT STARTED
Phase 6: NOT STARTED
```
