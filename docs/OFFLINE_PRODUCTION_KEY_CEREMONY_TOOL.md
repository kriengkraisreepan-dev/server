# Offline Production Key Ceremony Tool

สถานะ: implementation สำหรับสร้างชุดเครื่องมือ Offline เท่านั้น การ build/test ชุดนี้ **ไม่สร้าง Production Private Key**

Runtime ถูกล็อกเป็น Node.js `v24.18.0` SHA-256 `9A4EB5F1C29C6A2E93852EAD46B999E284A6A5CA8BAB4D4E241D587D025A52DE` ลงลายเซ็น Authenticode โดย OpenJS Foundation certificate thumbprint `CECD9673E955CA766047DD43706D31E48A6BD3B5` Builder ปฏิเสธ runtime ที่ version, hash หรือ signer ไม่ตรง

เครื่องมือไม่มี network import/API รับ passphrase แบบ hidden interactive input และไม่รับ passphrase ผ่าน command line สร้าง Ed25519 ใน memory ส่งออก encrypted PKCS#8 ด้วย AES-256-CBC ลง USB-A/USB-B โดยตรง ส่งออก Public SPKI PEM/DER และ metadata ไป USB-C คำนวณ fingerprint จาก SPKI DER ตาม `FirmwareProductionTrustStore` และทดสอบ correct signature/tamper rejection ก่อนรายงานสำเร็จ

USB ทั้งสามต้องเป็น drive root คนละตัว ห้ามใช้ system drive, UNC หรือโฟลเดอร์เดิม เครื่องมือไม่เขียนทับ งานล้มเหลวลบเฉพาะ directory ใหม่ที่เครื่องมือสร้างในรอบนั้น Package ไม่มี Private Key และมี manifest SHA-256 รายไฟล์

ห้ามเปิด `START-CEREMONY.cmd` จนกว่า Production Approver จะอนุญาตสร้าง Production Private Key จริง หลังนำ ZIP ไปเครื่อง Offline ต้องตรวจ SHA-256 ของ ZIP และเปิด `VERIFY-BUNDLE.cmd` ให้ผ่านก่อน
