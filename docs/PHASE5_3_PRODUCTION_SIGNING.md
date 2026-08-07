# Phase 5.3 — Production Signing Architecture

## สถานะ

```text
Architecture and implementation: COMPLETE
Production public key final enrollment: PENDING KEY CEREMONY
Production private key created: NO
Production distribution: NOT YET APPROVED
```

ระบบใช้ Ed25519 detached signature, SHA-256 ต่อไฟล์ และ canonical JSON ที่เรียง object keys แบบ deterministic งานปัจจุบันเป็น provenance-recorded build; ยังไม่อ้างว่า reproducible

## Trust boundary

- Production private key อยู่บน encrypted removable media แบบ offline สองชุดเท่านั้น
- Manager ฝัง public-key allowlist และ revoked-key registry จาก [firmware-production-trust.json](../config/firmware-production-trust.json) Browser และ package แก้ trust anchor ไม่ได้
- Test key, Production signing key, verification public key, Device Key, Setup Code และ Wi-Fi credential แยกหน้าที่กัน
- Production builder เป็นคำสั่งผู้ดูแล release โดยตรง ไม่มี HTTP/Browser endpoint
- Runtime verifier เลือก key ด้วย `signingKeyId`, ตรวจ fingerprint, validity/overlap และ revocation ก่อนตรวจ signature

## บทบาท

| บทบาท | หน้าที่ | เข้าถึง private key |
|---|---|---|
| Developer | Build/test/source review | ไม่ได้ |
| Release Operator | เตรียม inputs และทำ offline release | เฉพาะระหว่าง ceremony ที่อนุมัติ |
| Production Approver/OWNER | อนุมัติ release และ custody | ได้ตาม ceremony |
| Installer/Technician | ใช้ signed package | ไม่ได้ |
| Store Owner ในงานประจำ | ใช้ Hardware Manager | ไม่ได้จากเครื่องร้าน |

บุคคลเดียวถือหลายบทบาทได้ในธุรกิจขนาดเล็ก แต่ต้องยืนยัน Release Operator และ Production Approver แยกกัน

## การแยก Channel

Test v1 อยู่ใต้ `runtime/firmware-packages/test`. Production-like test อยู่ใต้ `runtime/firmware-packages/production-like-test` และใช้ `signingEnvironment=production-like-test`. Production จริงอยู่ใต้ `runtime/firmware-packages/production/<version>/<buildId>` และรับเฉพาะ `signingEnvironment=production` Production verifier ปฏิเสธ Test Package เสมอ

Structured events ไม่มี secret: `PRODUCTION_RELEASE_BUILD_STARTED`, `PRODUCTION_SIGNING_KEY_SELECTED`, `PRODUCTION_SIGNING_KEY_REJECTED`, `PRODUCTION_RELEASE_BUILD_SUCCEEDED`, `PRODUCTION_RELEASE_BUILD_FAILED`, `PRODUCTION_PACKAGE_VERIFICATION_SUCCEEDED`, `PRODUCTION_PACKAGE_VERIFICATION_FAILED`, `PRODUCTION_RELEASE_DUPLICATE_REJECTED`.
