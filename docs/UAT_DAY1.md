# UAT Day 1 — Startup, Accounts, Dashboard, Tables

วันที่ทดสอบ: __________  Build: __________  เครื่อง: __________

| Test case | Expected result | Actual result | Pass/Fail | Operator | Date | Remark |
|---|---|---|---|---|---|---|
| D1-01 Cold start server | Server พร้อมใช้, log `SERVER_STARTED`, health ไม่ CRITICAL | | □ Pass □ Fail | | | |
| D1-02 Login Owner | เข้าได้และเห็น Settings/Health | | □ Pass □ Fail | | | |
| D1-03 Login Manager | เข้าได้เฉพาะสิทธิ์ Manager | | □ Pass □ Fail | | | |
| D1-04 Login Cashier | เข้าได้และไม่เห็น Owner operation | | □ Pass □ Fail | | | |
| D1-05 Invalid login | ถูกปฏิเสธโดยไม่เปิดเผยข้อมูลบัญชี | | □ Pass □ Fail | | | |
| D1-06 Dashboard initial load | ยอดและสถานะโต๊ะตรงข้อมูลตั้งต้น | | □ Pass □ Fail | | | |
| D1-07 Open free table | Session เริ่มครั้งเดียว เวลาเดิน Relay ตรง desired state | | □ Pass □ Fail | | | |
| D1-08 Pause/resume table | เวลาและสถานะต่อเนื่อง ไม่สร้าง session ใหม่ | | □ Pass □ Fail | | | |
| D1-09 Two tabs same table | มีเพียงคำสั่งที่ถูกต้องสำเร็จ ไม่มี session ซ้ำ | | □ Pass □ Fail | | | |
| D1-10 Logout | Session ใช้ต่อไม่ได้และ API ตอบ 401 | | □ Pass □ Fail | | | |

ผู้สรุป: __________  □ ผ่านทั้งวัน  □ มี issue ต้องแก้  Issue IDs: __________
