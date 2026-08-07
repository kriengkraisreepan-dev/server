# Production Key Rotation and Revocation

- หมุน key ทุก 12 เดือน หรือทันทีเมื่อสงสัยว่ารั่ว
- Enroll key ใหม่ก่อนเริ่มใช้และอนุญาต overlap key เดิม/ใหม่สูงสุด 90 วัน
- `validFrom`/`validUntil` บังคับตาม `createdAt` ของ signed manifest หลัง overlap ห้ามสร้าง package ใหม่ด้วย key เดิม
- Revocation บันทึกใน embedded `revokedKeys` พร้อม `revokedAt`, เหตุผล และ `revokeAll`
- `revokeAll=true` ปฏิเสธ package ทั้งหมดจาก key นั้น มิฉะนั้นปฏิเสธ package ที่ `createdAt >= revokedAt`
- Browser/package แก้ registry ไม่ได้ Unknown, expired และ revoked key fail closed

ข้อจำกัด: Manager รุ่นเก่าที่ไม่ได้รับ release ซึ่งมี registry ใหม่อาจยังไม่รู้การ revoke จึงต้องหยุด distribution เก่าและอัปเดต Manager ตาม incident runbook
