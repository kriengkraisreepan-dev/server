LUCKY SNOOKER MANAGER — OFFLINE PRODUCTION KEY CEREMONY TOOL

สถานะ: เครื่องมือสร้าง Key แบบ Offline — ภายใน ZIP ไม่มี Production Private Key

ก่อนใช้งาน:
1. เครื่องต้อง Offline: ถอด LAN, ปิด Wi-Fi และ Bluetooth
2. USB-A และ USB-B ต้องเข้ารหัสและปลดล็อกแล้ว
3. USB-C ต้องเป็นสื่อสำหรับ Public Key เท่านั้น
4. USB ทั้งสามต้องเป็นคนละไดรฟ์ และห้ามใช้ C:\
5. ตรวจ SHA-256 ของ ZIP จากรายงานที่ได้รับ
6. แตก ZIP แล้วเปิด VERIFY-BUNDLE.cmd ต้องขึ้น PASS

เมื่อได้รับอนุมัติให้สร้าง Production Private Key จริงแล้วเท่านั้น:
1. เปิด START-CEREMONY.cmd
2. ทำตามคำถามทีละข้อ
3. Passphrase จะไม่แสดงบนจอและไม่ถูกบันทึก
4. หากพบโฟลเดอร์เดิม เครื่องมือจะหยุดและไม่เขียนทับ
5. เมื่อสำเร็จ USB-A/USB-B จะมี Private Key ที่เข้ารหัส ส่วน USB-C มีเฉพาะ Public Key

ห้ามส่ง Private Key, passphrase หรือ BitLocker Recovery Key ผ่าน Browser, Chat, Email หรือ Cloud
ห้ามใช้เครื่องมือนี้บนเครื่องที่เชื่อมต่อ Network
