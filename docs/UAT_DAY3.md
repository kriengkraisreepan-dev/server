# UAT Day 3 — Reservation and Deposit

วันที่ทดสอบ: __________  Build: __________

| Test case | Expected result | Actual result | Pass/Fail | Operator | Date | Remark |
|---|---|---|---|---|---|---|
| D3-01 Create reservation | สร้าง reservation และ AVAILABLE deposit ครั้งเดียว | | □ Pass □ Fail | | | |
| D3-02 Type during polling | ฟอร์มไม่หาย รายการและ dashboard ยัง refresh | | □ Pass □ Fail | | | |
| D3-03 Decision Modal 30 seconds | Modal คงอยู่ กด Open Now สำเร็จคลิกแรก | | □ Pass □ Fail | | | |
| D3-04 Defer | เลื่อนครั้งเดียวและแจ้งเตือนใหม่ตามกำหนด | | □ Pass □ Fail | | | |
| D3-05 Check-in | ไม่รีเซ็ต billing start time | | □ Pass □ Fail | | | |
| D3-06 No-show | Session/relay ปิด มัดจำเป็น FORFEITED ตาม policy | | □ Pass □ Fail | | | |
| D3-07 All tables occupied | Reservation เข้าคิวโดยไม่เปิดโต๊ะผิดตัว | | □ Pass □ Fail | | | |
| D3-08 Deposit settlement | gross = deposit + remaining | | □ Pass □ Fail | | | |
| D3-09 Refund deposit | เฉพาะผู้มีสิทธิ์ มีเหตุผล และไม่ refund ซ้ำ | | □ Pass □ Fail | | | |
| D3-10 Open Now vs Defer two tabs | สำเร็จหนึ่ง operation อีกคำสั่งได้ conflict ชัดเจน | | □ Pass □ Fail | | | |

ผู้สรุป: __________  □ ผ่านทั้งวัน  □ มี issue ต้องแก้  Issue IDs: __________
