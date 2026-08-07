# UAT Day 5 — Recovery, Hardware and Long Session

วันที่ทดสอบ: __________  Build: __________  UPS/ESP32/Printer IDs: __________

| Test case | Expected result | Actual result | Pass/Fail | Operator | Date | Remark |
|---|---|---|---|---|---|---|
| D5-01 Restart with active table | Session และ start time เดิมกลับมา | | □ Pass □ Fail | | | |
| D5-02 Power loss during payment | ไม่สร้าง payment/bill/deposit settlement ซ้ำ | | □ Pass □ Fail | | | |
| D5-03 Power loss during JSON write | กู้ primary หรือ `.bak`; ไม่สร้างข้อมูลว่างทับ | | □ Pass □ Fail | | | |
| D5-04 Stale deposit lock | deterministic case ฟื้น; ambiguous caseถูกรายงาน | | □ Pass □ Fail | | | |
| D5-05 ESP32 online | ON/OFF ตรง desired/actual state | | □ Pass □ Fail | | | |
| D5-06 ESP32 offline/reconnect | จำกัด retry แจ้งเตือน และกลับมาสั่งงานได้ | | □ Pass □ Fail | | | |
| D5-07 UPS mains failure | เครื่องทำงาน/ปิดอย่างปลอดภัยตาม runbook | | □ Pass □ Fail | | | |
| D5-08 Network interruption | Browser ฟื้นหลังเครือข่ายกลับ ไม่มีรายการซ้ำ | | □ Pass □ Fail | | | |
| D5-09 Eight-hour live session | Memory/timer/response ไม่เสื่อมผิดปกติ | | □ Pass □ Fail | | | |
| D5-10 Graceful shutdown | มี `SERVER_SHUTDOWN` และ `SERVER_STOPPED` logs | | □ Pass □ Fail | | | |

ผู้สรุป: __________  □ ผ่านทั้งวัน  □ มี issue ต้องแก้  Issue IDs: __________
