# Phase 5.5 — USB Wi-Fi Recovery & Reauthentication

Backend เป็นเจ้าของ COM session และใช้ PowerShell/.NET `SerialPort` ที่มีใน Windows โดยส่ง JSON ผ่าน stdin ไม่ใส่ Wi-Fi password, Setup Code หรือ Device Key ใน command line/logs

Firmware รับเฉพาะ prefix `LUCKY_RECOVERY:` และตอบ `LUCKY_RECOVERY_RESPONSE:` payload สูงสุด 768 bytes คำสั่งอื่นถูกปฏิเสธ

Device Key rotation ใช้ Setup Code attempts/10-minute lockout เดิม, key ใหม่จาก Backend CSPRNG 32 bytes, Firmware candidate slot, Backend nonce/HMAC และ commit หลังตรวจ Device ID/Relay Count/Relay OFF หาก timeout/reboot/cancel ก่อน commit จะ rollback หาก Firmware commit แล้วแต่ vault ล้มเหลว จะคง key ใน memory และ Retry ได้ไม่เกิน 3 ครั้ง โดยห้ามรายงานสำเร็จ

การเปิด SerialPort บน USB-UART บางรุ่นอาจสัมพันธ์กับวงจร auto-reset แม้ DTR/RTS ถูกปิดไว้ ต้องยืนยันบน hardware จริงก่อนปิด Phase และห้ามต่อโหลดไฟบ้านระหว่าง acceptance
