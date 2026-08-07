# Hardware Acceptance — Wiring Assistant

สถานะ: **ผ่านบางส่วนบน "Lucky Relay 01"** (กล่องเดียวที่ใช้งานจริง) — "Lucky Relay Test" (กล่องสำรอง ไม่ผูกกับโต๊ะใด) ถูกตัดออกจากขอบเขตการตรวจตามคำสั่งเจ้าของร้าน เนื่องจากใช้งานส่วนตัวร้านเดียว ไม่ได้จำหน่าย/แจกจ่าย จึงไม่จำเป็นต้องตรวจให้ครบทุกกล่อง

ที่ผ่านแล้วจริงบน Lucky Relay 01 ระหว่าง Manual Windows Acceptance (ดู [PHASE6A_MANUAL_ACCEPTANCE.md](PHASE6A_MANUAL_ACCEPTANCE.md)): ตั้ง Relay Count, ทดสอบครบ 4 ช่อง (`relayTestStatus: PASSED`), พิมพ์ Wiring Sheet ได้ข้อมูลครบไม่มี credential หลุด

ยังไม่ได้ตรวจ (ข้ามได้ถ้าไม่คิดใช้งานหนัก/ไม่วางแผนเปลี่ยนกล่องบ่อย): Reboot ESP32 แล้ว Wiring Profile ยังอยู่ไหม, เปลี่ยน IP แล้ว Profile ยังอยู่ไหม, ทดสอบสองกล่องพร้อมกันว่าไม่สลับ mapping (ข้ามไปแล้วเพราะเหลือกล่องเดียวที่ใช้งาน), Phase 5.4B ข้อ 1–6 ด้านล่าง (ถอดไฟจริงแล้วนับ 3 ครั้งค่อย Offline)

## Checklist

- ถอดโหลดไฟบ้านทั้งหมดและใช้ไฟแรงดันต่ำเท่านั้น
- ตั้ง Relay Count ให้ตรงกับ board
- ทดสอบทีละช่องและตรวจ LED/เสียงคลิก
- บันทึกผล mapping และพิมพ์ Wiring Sheet
- Reboot ESP32 แล้วตรวจว่า Wiring Profile ยังอยู่
- เปลี่ยน IP แล้วตรวจว่า Profile ยังอยู่
- ทดสอบกล่องที่สองโดยยืนยันว่า Profile และ Relay state ไม่สลับกล่อง
- ยืนยันว่า Wiring Sheet ไม่มี Device Key, Setup Code, Wi-Fi password หรือ session token

ห้ามทำ power-loss injection ระหว่าง Relay pulse และหยุดทดสอบทันทีหาก OFF verification ล้มเหลว งาน software ไม่อนุญาตให้ Flash hardware อัตโนมัติ
# Phase 5.4B Manual Hardware Acceptance — PENDING

ใช้เฉพาะกล่องทดสอบที่ถอดโหลดไฟบ้านและ Relay ทุกช่อง OFF:

1. เปิด Hardware Manager และยืนยันรอบตรวจโดยไม่กด Refresh
2. ถอดไฟกล่องทดสอบ; ครั้งแรก/ครั้งที่สองต้องยังไม่เป็น Offline และครั้งที่สามจึง Offline
3. เปิดไฟใหม่และยืนยันว่ากลับ Online อัตโนมัติ พร้อม Last seen/Last checked ใหม่
4. ทดสอบสองกล่องและยืนยันว่ากล่องที่ไม่ถูกถอดไฟไม่เปลี่ยนสถานะ
5. เปิด Wizard/modal ค้างไว้และยืนยันว่า polling ไม่ปิด modal
6. ตรวจ Dark/Light และ UI scale 125%
7. ยืนยันจากอุปกรณ์จริงว่า Relay ไม่มีช่องใดเปลี่ยนสถานะ

ห้ามใช้กล่องที่ควบคุมโต๊ะใช้งานจริงหรือมี Relay ON
