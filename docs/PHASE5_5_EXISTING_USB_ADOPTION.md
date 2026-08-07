# Phase 5.5 — Existing ESP32 USB Adoption

สถานะ: `INTERNAL TEST — NOT FOR PRODUCTION`

## ใช้เมื่อใด

ใช้เมื่อตัวช่วยตั้งค่าค้นพบกล่อง Firmware 1.2.0 ได้ แต่ Customer Data ชุดปัจจุบันไม่มี Hardware record หรือ secret ใน DPAPI vault ตัวช่วยจะแสดงข้อความว่าไม่มีข้อมูลยืนยันกล่องในคอมพิวเตอร์และเสนอปุ่ม “เพิ่มกล่องนี้ผ่าน USB” โดยไม่ถาม Device Key

## ขั้นตอนทดสอบด้วยตนเอง

1. ห้าม Flash ซ้ำ ห้ามเลือก New Install และห้ามลบ NVS
2. เสียบกล่องเดิมด้วย USB และเลือก COM Port ที่ถูกต้อง
3. กรอกชื่อกล่อง ตำแหน่ง (ถ้ามี) และ Setup Code ปัจจุบัน
4. ถอดโหลดไฟบ้าน ตรวจว่า Relay ทุกช่อง OFF แล้วจึงยืนยัน
5. ระบบอ่าน Device ID, Firmware, API และ Relay Count จาก Firmware โดยตรง
6. ระบบเปลี่ยน Device Key แบบ transactional, ตรวจ nonce/HMAC และตรวจ Relay OFF ซ้ำก่อน commit
7. หลังตรวจ key ใหม่แบบ read-only ผ่านแล้ว ระบบจึงเก็บ key ใน DPAPI vault และสร้าง Hardware record แบบ atomic
8. Wizard เปิดต่อที่ขั้นหลัง authentication เพื่อให้ทดสอบ/ตั้งค่าต่อได้

สำหรับกล่องทดสอบปัจจุบันให้คาดหวัง Device ID `LRC-88A4750FF0A4`, Firmware `1.2.0`, API `1`, Relay Count `4` และ COM3 แต่ Backend ต้องอ่านและตรวจค่าจริงจาก Firmware เสมอ

## Failure และ recovery

- ก่อน Firmware commit: ระบบ rollback candidate key และไม่สร้าง record/vault
- หลัง Firmware commit แต่ vault บันทึกล้มเหลว: งานเป็น `VAULT_RECOVERY_REQUIRED`; ห้ามปิดโปรแกรมหรือถอด USB และกด Retry โดยใช้ key เดิมใน memory
- หาก Server restart ระหว่าง recovery: key ใน memory หาย ระบบ fail closed และไม่สร้าง record ต้องใช้ recovery สำหรับ Test Hardware ผ่าน Setup Code
- Device ID ซ้ำหนึ่งรายการที่เป็น `REAUTHENTICATION_REQUIRED` ต้องไป workflow reauthentication เดิม; รายการซ้ำหรือกำกวมต้องหยุด
- หาก token preflight ล้มเหลว ระบบจะแสดงสาเหตุเฉพาะ เช่น IDENTIFY timeout, Relay Safety timeout, COM Port busy หรือ serial response ไม่ถูกต้อง โดยยังไม่ส่ง Setup Code และไม่เริ่ม key rotation
- Setup Code ในช่องกรอกจะถูกล้างเมื่อ token preflight ผ่านและกำลังส่ง adoption start เท่านั้น

## Security boundaries

Browser ไม่รับหรือส่ง Device Key, `apiKey`, `secretId`, HMAC secret, NVS path หรือ Hardware record ID ข้อมูลลับไม่ถูกบันทึกใน log หรือ temporary file Token ใช้ครั้งเดียว ผูกกับ draft, OWNER/ADMIN, authenticated session, loopback, COM Port, identity, release channel และวันหมดอายุ ทุกคำสั่ง adoption เป็น read-only ต่อ Relay และไม่มี automatic all-off
