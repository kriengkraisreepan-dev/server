# Manual UAT Matrix — 50 Real-World Scenarios

บันทึกผลใน UAT Day 1–5 โดยใช้ Scenario ID ด้านล่างเป็นหลักฐานอ้างอิง

| ID | Scenario | Expected result | Priority |
|---:|---|---|---|
| 01 | Cold start ก่อนเปิดร้าน | Server พร้อมใช้, health ไม่ CRITICAL | Critical |
| 02 | Restart ขณะมี Active Table | Session และเวลาเริ่มเดิมกลับมา | Critical |
| 03 | ไฟดับระหว่างเขียน JSON | กู้ primary/backup และไม่สร้างข้อมูลว่าง | Critical |
| 04 | ไฟดับระหว่างชำระเงิน | ไม่มี bill/payment/settlement ซ้ำ | Critical |
| 05 | ปิดระบบด้วย Ctrl+C | มี shutdown/stop logs และข้อมูล parse ได้ | High |
| 06 | Owner login | เข้าได้และเห็น Owner controls | High |
| 07 | Cashier พยายามเข้า Settings | API ตอบ 403 | High |
| 08 | Disabled user login | ถูกปฏิเสธ | High |
| 09 | Session หมดอายุระหว่างพักหน้าจอ | กลับหน้า login โดยไม่สูญธุรกรรมที่สำเร็จ | High |
| 10 | Logout แล้วใช้แท็บเดิม | API ตอบ 401 | High |
| 11 | เปิดโต๊ะว่าง | Session/เวลา/Relay ถูกต้อง | Critical |
| 12 | สองแท็บเปิดโต๊ะเดียวกัน | สำเร็จครั้งเดียว | Critical |
| 13 | Pause และ Resume | เวลา billable ถูกต้อง | High |
| 14 | Checkout สองคลิก | สร้างบิลครั้งเดียว | Critical |
| 15 | ยกเลิก session ก่อนคิดเงิน | ไม่มีบิลหรือรายได้หลงเหลือ | High |
| 16 | Walk-in ไม่มีสมาชิก | บิลและยอดถูกต้อง | High |
| 17 | Walk-in ผูกสมาชิก | สมาชิก snapshot ถูกต้อง | High |
| 18 | POS สินค้าอย่างเดียว | Stock และยอดบิลถูกต้อง | Critical |
| 19 | สินค้า stock ไม่พอ | ปฏิเสธโดยไม่ติดลบ | High |
| 20 | ยืนยัน POS ซ้ำ | ไม่ตัด stock ซ้ำ | Critical |
| 21 | Combined bill | ค่าโต๊ะ+สินค้าเท่ากับ gross | Critical |
| 22 | Confirm payment ซ้ำ | รับรู้ชำระครั้งเดียว | Critical |
| 23 | Void bill | ต้องมีเหตุผลและคงเลขเดิม | Critical |
| 24 | Void พร้อม report refresh | รายงานไม่เห็นข้อมูลครึ่งสถานะ | High |
| 25 | Printer online | ใบเสร็จครบและอ่านง่าย | High |
| 26 | Printer offline | ธุรกรรมยังคงอยู่และแจ้งผู้ใช้ | High |
| 27 | Reprint receipt | ใช้เลขเดิม | High |
| 28 | สร้าง Reservation | Reservation/deposit เกิดครั้งเดียว | Critical |
| 29 | พิมพ์ฟอร์มระหว่าง polling | ค่าที่กรอกไม่หาย | Critical |
| 30 | Reservation ถึงเวลาเมื่อโต๊ะว่าง | Decision Modal แสดง | Critical |
| 31 | Reservation ถึงเวลาเมื่อโต๊ะเต็ม | เข้าคิว ไม่เปิดโต๊ะผิดตัว | Critical |
| 32 | Walk-in และ Reservation มาพร้อมกัน | ไม่มีการแย่งโต๊ะจนเกิด session ซ้ำ | Critical |
| 33 | Modal เปิดค้าง 30 วินาทีแล้ว Open Now | สำเร็จคลิกแรก | Critical |
| 34 | Modal เปิดค้างแล้ว Defer | สำเร็จคลิกแรก | Critical |
| 35 | สองแท็บ Open Now กับ Defer | สำเร็จหนึ่ง operation | Critical |
| 36 | Check-in | ไม่รีเซ็ตเวลาเปิดโต๊ะ | Critical |
| 37 | No-show | ปิด session/relay และ forfeit ตาม policy | Critical |
| 38 | Deposit settlement | gross = deposit + remaining | Critical |
| 39 | Refund deposit | สิทธิ์/เหตุผลถูกต้องและไม่ซ้ำ | Critical |
| 40 | Settlement พร้อม Refund | สำเร็จเพียง operation ที่ถูกต้อง | Critical |
| 41 | Member earn | แต้มตรงเวลาโต๊ะ | High |
| 42 | Member redeem | ยอดและแต้มคงเหลือถูกต้อง | High |
| 43 | Redeem ซ้ำ | ถูกปฏิเสธ ไม่มีส่วนลดซ้ำ | Critical |
| 44 | Backup manual | VERIFIED, checksum และ 3 ไฟล์ครบ | Critical |
| 45 | Backup แล้ว Restore dry-run | ไม่เปลี่ยน production data | Critical |
| 46 | Actual restore ข้อมูลทดสอบ | มี pre-restore backup และข้อมูลครบ | Critical |
| 47 | Backup เสียหาย | INVALID และ restore ไม่ได้ | Critical |
| 48 | ESP32 offline | retry จำกัดและ business stateไม่หาย | High |
| 49 | ESP32 reconnect | desired/actual กลับมาตรงกัน | High |
| 50 | ใช้งานต่อเนื่องเต็มกะ | ไม่มี timer ซ้ำ, modal ซ้อน หรือ memory เพิ่มผิดปกติ | High |
# Phase 5.4A Display Acceptance

สถานะ: `COMPLETE — USER ATTESTATION 2026-08-04`

ผู้ใช้งานยืนยันว่า Manual Browser Acceptance ผ่านแล้ว Codex บันทึกคำยืนยันนี้เป็นหลักฐานจากผู้ใช้งานและไม่ได้อ้างว่าเป็นผู้ตรวจภาพด้วยตนเอง

ทดสอบที่ 1366×768 และ 1920×1080 สำหรับ Theme: dark, light, system→dark, system→light และ Scale: 90%, 100%, 110%, 125%

ตรวจ workflow: Login, เปิด/ปิดโต๊ะด้วยข้อมูลทดสอบ, POS, Checkout แบบทดสอบ, Bill History, Reservation, Member, Reports, Settings, Hardware Manager, Setup Wizard, USB Flasher modal, Wiring Assistant, Print receipt และ Print Wiring Sheet

เกณฑ์ร่วม: ไม่มีข้อความล้น/ถูกตัด, modal ปิดได้และ scroll ถึงปุ่ม, ตารางเลื่อนแนวนอนได้, focus มองเห็น, สถานะไม่สื่อด้วยสีเพียงอย่างเดียว, งานพิมพ์พื้นขาว/ตัวดำ/scale 100% และไม่มี navigation/control
# Phase 5.4B Hardware Health — PENDING

ทดสอบ automatic ONLINE → TIMEOUT → OFFLINE → ONLINE recovery, Last seen/Last checked, two-device isolation, modal retention, Dark/Light และ scale 125% ตาม `HARDWARE_ACCEPTANCE.md` โดยไม่มีโหลดไฟบ้านและ Relay ทุกช่อง OFF
