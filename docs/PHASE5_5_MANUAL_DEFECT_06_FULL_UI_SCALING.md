# Phase 5.5 Manual Defect 06 — Full UI Scaling

สถานะ: แก้ไขใน Internal Portable Revision 8 (`INTERNAL TEST — NOT FOR PRODUCTION`)

## อาการ

ตัวเลือกขนาด 90%, 110% และ 125% เดิมเปลี่ยน root font size เท่านั้น แต่โครงหน้าหลักจำนวนมากใช้หน่วย `px` ทำให้ sidebar, card, grid, table, modal และระยะห่างคงขนาดเดิม ผู้ใช้จึงเห็นชัดเพียงข้อความและปุ่มบางส่วนที่เปลี่ยนขนาด

## การแก้ไข

- ใช้ full-page CSS layout zoom ที่ root ตามค่า allowlist เดิม 90%, 100%, 110% และ 125%
- sidebar, main content, card, grid, table, modal, input, button และ spacing เปลี่ยนขนาดพร้อมกัน
- ไม่ใช้ `transform: scale()` จึงไม่สร้างพื้นที่ว่างจาก visual-only transform
- modal ยังคงจำกัดความสูงและเลื่อนได้ ตารางยังเลื่อนแนวนอนได้
- งานพิมพ์บังคับกลับ 100% เหมือนเดิม
- ไม่มีการเปลี่ยน API, Customer Data, Billing, POS, Hardware, Relay หรือ Firmware

## Manual Acceptance

ทดสอบ Revision 8 ที่ 90%, 100%, 110% และ 125% บนจอจริง ตรวจว่าทั้ง sidebar, card, table และ modal เปลี่ยนขนาดพร้อมกัน ไม่มีข้อความหรือปุ่มถูกตัด modal เลื่อนถึงปุ่มล่างสุดได้ และเปลี่ยนหน้าหรือเปิดโปรแกรมใหม่แล้วยังคงค่าที่เลือก
