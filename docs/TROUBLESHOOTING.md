# แก้ปัญหา Lucky Relay Controller

| อาการ | สาเหตุที่พบบ่อย | วิธีแก้ |
|---|---|---|
| Build ไม่ผ่าน | เปิดโฟลเดอร์ผิดหรือ PlatformIO ยังไม่ครบ | เปิด `server\firmware`, รอ PlatformIO ติดตั้ง แล้วกด Build อีกครั้ง |
| Upload ไม่ได้ | สาย USB ไม่มี data / COM Port ผิด | เปลี่ยนสาย, ดู Device Manager, กด BOOT ระหว่าง Connecting |
| ไม่เห็น COM Port | Driver หรือสายมีปัญหา | ถอดเสียบใหม่, เปลี่ยน USB, ติดตั้ง driver ตาม USB chip ของบอร์ด |
| Serial อ่านไม่ออก | Baud rate ไม่ตรง | ตั้ง Serial Monitor เป็น `115200` |
| Wi‑Fi ไม่เชื่อม | ชื่อ/รหัสผิด หรือสัญญาณอ่อน | เข้า Setup Portal ด้วย Setup Code และตรวจเครือข่าย โดยห้ามใช้ shared bootstrap credential |
| ได้ 401 Unauthorized | ไม่มี/Key ไม่ถูกต้อง | ใส่ Header `X-Lucky-Device-Key` ที่ตรงกับ ESP32 |
| ได้ 404 | URL หรือช่อง Relay ไม่ถูกต้อง | ใช้ `/api/v1/...`; ตรวจ relayCount และใช้ช่อง 1 ถึงจำนวนที่ตั้ง |
| Relay ไม่คลิก | ต่อ GPIO/กราวด์/ไฟเลี้ยงไม่ถูก | ตรวจ [WIRING](../firmware/docs/WIRING.md), GPIO mapping และแหล่งจ่าย 5V |
| LED Relay ไม่ติด | โมดูล Active LOW หรือขา IN ต่อผิด | ทดสอบ API ON/OFF, ตรวจ GPIO และอย่าจ่ายคอยล์จาก ESP32 3.3V |
| Relay เปิดตอน Boot | การติดตั้งหรือ Firmware ไม่ตรง | หยุดเชื่อมโหลดจริง, ทำ Safe Boot Test และตรวจ `BOOT_COMPLETE` |

## ข้อมูลที่ควรจดก่อนขอความช่วยเหลือ

- ภาพหน้าจอ Build/Upload error บรรทัดแรก
- COM Port ที่เลือก
- Serial log ตั้งแต่เปิดเครื่องถึง `BOOT_COMPLETE`
- ผล `GET /api/v1/health`
- รุ่น ESP32, จำนวน Relay และช่องที่ทดสอบ

### ✓ Expected Result

คุณสามารถแยกปัญหาเป็น Build, USB/COM, Wi‑Fi, API หรือการต่อ Relay ได้

### ✓ Common Mistakes

- ส่ง Wi‑Fi password หรือ Device Key ในภาพ/แชต
- ต่อไฟบ้านเพื่อพยายามแก้ปัญหา LED ไม่ติด

### ✓ How to Fix

ปิดบังข้อมูลลับก่อนส่งหลักฐาน และแก้ Logic-side ให้ผ่านก่อนให้ช่างไฟตรวจวงจรจริง
