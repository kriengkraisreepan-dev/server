# Production Release Acceptance

สถานะปัจจุบัน: **PRODUCTION DISTRIBUTION NOT YET APPROVED**

## Release identity

Firmware version: ______  Build ID: ______  Source commit: ______  Signing Key ID: ______

## Separate confirmations

- [ ] Release Operator ยืนยัน inputs, provenance, clean workspace และผล verification
- [ ] Production Approver/OWNER ยืนยัน package และอนุมัติ distribution

ชื่อ/รหัสผู้ปฏิบัติงาน: ______  วันที่: ______

## Mandatory acceptance

- [ ] Third-party license/distribution review
- [ ] Antivirus scan
- [ ] Windows standalone execution
- [ ] CP210x acceptance
- [ ] CH340/CH341 acceptance
- [ ] Classic ESP32 4 MB hardware acceptance
- [ ] Existing Update รักษา NVS/Device identity/credentials
- [ ] New Install และ transactional enrollment handoff
- [ ] Manifest signature, every SHA-256 และ provenance
- [ ] Secret scan ไม่มี private key, Device Key, Setup Code หรือ Wi-Fi credential
- [ ] Public key allowlist และ revocation registry ผ่าน review
- [ ] Archive/retention location พร้อมใช้งาน

Decision: □ APPROVED  □ REJECTED

ห้ามสร้างหรือแจก Production release หากช่องใดยังไม่ผ่าน
