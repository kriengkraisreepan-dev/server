# Production Key Ceremony

## Preconditions

- Production Approver อนุมัติสถานที่เก็บสื่อและระบุ Backup Key Custodian ในเอกสารภายนอก
- Offline release worker ผ่าน malware/OS review และตัด network
- เตรียม encrypted removable media สองชุด แยกสถานที่ ห้ามใช้ cloud sync

## Ceremony

1. OWNER และ Release Operator บันทึกวันเวลาและบทบาท
2. สร้าง Ed25519 key บน offline worker ด้วยเครื่องมือที่ review แล้ว ห้ามใช้ script production-like test
3. Export private key ไป encrypted media สองชุดเท่านั้น ไม่เก็บใน workspace/application/backend
4. Export public SPKI, คำนวณ SHA-256 fingerprint และ Key ID `lrc-prod-YYYY-NN-<SPKI-SHA256-12HEX>`
5. ตรวจ public key/fingerprint จากสื่อทั้งสองชุด
6. ลบ key material และ temporary workspace จาก offline workerอย่างตรวจสอบได้
7. เก็บ passphrase แยกจากสื่อ private key
8. Enroll เฉพาะ public key, validity dates และ fingerprint เข้า Manager source ผ่าน reviewed change

ตรวจว่าสื่ออ่านได้และทำ recovery drill ปีละครั้ง เอกสาร recovery ห้ามมี private key หรือ passphrase Phase 5.3 รอบนี้ยังไม่อนุญาตให้ดำเนิน ceremony จริง
