# Phase 5.5 Manual Acceptance Defect 04 — Resolution

Defect: Generic Hardware Setup Wizard พบ ESP32 เดิมได้ แต่ Customer Data ใหม่ไม่มี Hardware record/DPAPI secret จึงยืนยันอุปกรณ์ไม่ได้

Resolution: เพิ่ม Existing ESP32 USB Adoption ซึ่งใช้ Setup Code ปัจจุบันเพื่อเริ่ม transactional Device Key rotation ผ่านคำสั่ง Serial ที่จำกัด ตรวจ candidate key ด้วย nonce/HMAC และสร้าง vault+record หลัง read-only network verification สำเร็จเท่านั้น

สิ่งที่ไม่เปลี่ยน: Firmware, Device ID, Setup Code, confirmed Wi-Fi, Relay Count, GPIO mapping และ Relay state ไม่มีการ Flash, Factory Reset หรือเปลี่ยน record ของกล่องอื่น

Manual acceptance ยังคง `PENDING`; หยุดก่อนเปิด Internal Portable Revision 6 และก่อนทำ USB adoption จริง
