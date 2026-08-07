# การค้นหากล่องควบคุมอัตโนมัติ

ฟังก์ชันนี้ช่วยค้นหา Lucky Relay Controller ในเครือข่ายโดยไม่ต้องหา IP เอง ระบบใช้ **Device ID** เป็นตัวตนถาวรของกล่อง ส่วน IP เป็นเพียงเลขที่อยู่ซึ่ง Router อาจเปลี่ยนได้

## วิธีใช้งาน

1. เปิด Hardware Manager
2. กด **ค้นหากล่องอัตโนมัติ**
3. รอระบบตรวจกล่องที่เคยบันทึกไว้และค้นหาในเครือข่าย
4. ตรวจชื่อ, Device ID, IP, Firmware และจำนวน Relay
5. หากพบหลายกล่อง ให้เลือกจากชื่อและ Device ID
6. กล่องใหม่จะเข้าสู่ Hardware Setup Wizard เพื่อยืนยันรหัสและทดสอบอย่างปลอดภัย

หากเป็นกล่องเดิมที่ Router แจก IP ใหม่ ระบบจะยืนยัน Device ID ก่อนอัปเดต IP โดยรักษารหัสอุปกรณ์และการผูก Relay กับโต๊ะเดิม

## กรอก IP ด้วยตนเอง

ช่องกรอก IP แบบเดิมยังใช้งานได้เสมอ กด **กรอก IP ด้วยตนเอง** เมื่อ:

- Router ปิด mDNS หรือ UDP broadcast
- กล่องอยู่คนละ VLAN
- เปิด Client Isolation
- Firewall ปิดกั้นการค้นหา
- Firmware รุ่นเดิมยังไม่มี Automatic Discovery

## เมื่อค้นหาไม่พบ

- ตรวจว่ากล่องเปิดอยู่
- ตรวจว่ากล่องและเครื่อง Backend อยู่ Router/VLAN เดียวกัน
- ปิด Client/AP Isolation สำหรับเครือข่ายอุปกรณ์
- ตรวจ DHCP Client List ใน Router
- ลองค้นหาอีกครั้ง
- ใช้ IP จาก Router กรอกด้วยตนเอง

การค้นหาข้าม Router, VLAN หรือ guest network โดยทั่วไปใช้ไม่ได้ เพราะ mDNS และ UDP broadcast ไม่ถูกส่งข้ามเครือข่าย

## ความปลอดภัย

- discovery packet ไม่มี Device Key หรือ Wi-Fi password
- ผล mDNS/UDP ยังไม่ถือว่าเชื่อถือได้จนกว่า Backend จะตรวจ REST API ทั้งสี่ endpoint
- การค้นหาใช้ public GET เท่านั้นและไม่ส่ง protected POST
- discovery ไม่เปิดหรือปิด Relay
- อุปกรณ์ใหม่ไม่ถูกบันทึกจนกว่าผู้ใช้จะเลือกและดำเนิน Wizard
- เฉพาะ OWNER และ ADMIN ใช้งานได้

## Firmware compatibility

| Firmware | Saved IP | Manual IP | mDNS/UDP | Device ID migration |
|---|---:|---:|---:|---:|
| 1.0.x เดิม | ได้ | ได้ | ไม่ได้ | ไม่มี |
| Phase 2 build | ได้ | ได้ | ได้ | `LRC-0001` เปลี่ยนเป็น ID จาก eFuse พร้อม legacy alias |

ระบบไม่ย้าย legacy record จาก discovery โดยอัตโนมัติ ผู้ใช้ต้องยืนยันใน Wizard และผ่าน Device Key nonce/HMAC challenge ก่อนเสมอ หาก legacy record กำกวม ระบบจะ fail closed และไม่ย้าย mapping
