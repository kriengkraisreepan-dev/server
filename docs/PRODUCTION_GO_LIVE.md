# Production Go-Live Checklist

วันที่เป้าหมาย: __________  Build: __________  Owner: __________

## Server and Windows

- [ ] เครื่อง Server ใช้ CPU 4 cores ขึ้นไป, RAM 8 GB ขั้นต่ำ (แนะนำ 16 GB), SSD ว่างอย่างน้อย 20 GB
- [ ] Windows 11 64-bit อัปเดต security patches แล้ว
- [ ] Node.js version: __________ (`node --version`) และตรงเวอร์ชันที่ผ่าน UAT
- [ ] Time zone เป็น `(UTC+07:00) Bangkok, Hanoi, Jakarta`
- [ ] เวลา Windows sync ถูกต้อง
- [ ] ปิด Sleep/Hibernate ระหว่างเวลาเปิดร้าน
- [ ] กำหนด Windows restart/update นอกเวลาเปิดร้าน
- [ ] Server ใช้ wired Ethernet และกำหนด IP/DHCP reservation
- [ ] Windows Firewall เปิดเฉพาะ port ที่ร้านต้องใช้บน private network
- [ ] ไม่มี server process สองตัวใช้ data directory เดียวกัน

## Data and backup

- [ ] ตรวจ JSON ทั้งสามไฟล์และเก็บสำเนาก่อน go-live
- [ ] `GET /api/health` ไม่เป็น CRITICAL
- [ ] `GET /api/integrity` ไม่มี ERROR ที่ไม่อธิบาย
- [ ] Automatic backup ทำงานและสถานะ VERIFIED
- [ ] Restore dry-run เป็น RESTORABLE
- [ ] Actual restore ผ่านบนข้อมูลทดสอบ
- [ ] Daily backup policy: local verified backup ทุกวัน
- [ ] Copy backup ไปสื่อ/เครื่องอื่นอย่างน้อยวันละครั้ง
- [ ] Retention และผู้รับผิดชอบ backup: ____________________
- [ ] มี runbook สำหรับ power loss และ corrupt JSON

## UPS

- [ ] UPS line-interactive พร้อม AVR ขนาดอย่างน้อย 800–1200 VA
- [ ] Server, router/switch และอุปกรณ์สำคัญต่อ UPS
- [ ] ทดสอบถอดไฟจริงและเวลา runtime
- [ ] กำหนดวิธี graceful shutdown ก่อนแบตหมด
- [ ] วันที่เปลี่ยนแบต/ทดสอบครั้งถัดไป: __________

## ESP32 and network

- [ ] ESP32 ใช้ regulated power supply และกล่องป้องกัน
- [ ] Relay module มี isolation และพิกัดเหมาะกับโหลด
- [ ] สายไฟแรงดันสูงติดตั้งโดยช่างที่มีคุณสมบัติ
- [ ] ESP32 มี IP reservation, ชื่ออุปกรณ์ และเลขโต๊ะชัดเจน
- [ ] ทดสอบ ON/OFF โต๊ะละ 100 ครั้ง
- [ ] ทดสอบ offline, timeout และ reconnect
- [ ] Router เป็น dual-band gigabit รุ่นธุรกิจ/SMB พร้อม UPS
- [ ] แยก guest Wi-Fi ออกจากเครือข่าย POS/ESP32

## Printer

- [ ] Thermal receipt printer 80 mm ที่มี Windows driver เสถียร
- [ ] แนะนำ Ethernet/USB แบบติดตั้งถาวร; หลีกเลี่ยง Bluetooth สำหรับจุดคิดเงินหลัก
- [ ] พิมพ์ไทย ตัวเลข ยอดรวม และ QR ได้ชัดเจน
- [ ] ทดสอบ offline, กระดาษหมด, reprint และ restart
- [ ] มีกระดาษสำรองและขั้นตอนออกใบเสร็จเมื่อเครื่องเสีย

## Accounts

- [ ] Owner account Active และเปลี่ยนรหัสเริ่มต้นแล้ว
- [ ] Manager account Active และทดสอบสิทธิ์แล้ว
- [ ] Cashier account แยกตามผู้ใช้งานและทดสอบสิทธิ์แล้ว
- [ ] ปิดบัญชีพนักงานที่ไม่ใช้งาน
- [ ] เก็บรหัส recovery ตามนโยบายร้าน ไม่ติดไว้หน้าเครื่อง

## Final gate

- [ ] UAT Day 1–5 ผ่าน
- [ ] ไม่มี Critical issue เปิดค้าง
- [ ] Backup และ Restore ลงนามแล้ว
- [ ] Power-loss, ESP32 และ Printer ผ่าน
- [ ] Owner อนุมัติ GO

Decision: □ GO  □ NO GO  
Owner signature: ____________________  Date/time: ____________________
