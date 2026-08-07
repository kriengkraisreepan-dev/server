# Hardware Manager

## Hardware Wiring Assistant

Device Card ที่ Online มีปุ่ม **ตรวจสอบการต่อสาย** สำหรับดูผัง LHS-1.0 ตาม Relay Count จริง ทดสอบ pulse รายช่อง บันทึก Wiring Profile และพิมพ์ Wiring Sheet ดูขั้นตอนเต็มใน [HARDWARE_WIRING_ASSISTANT.md](HARDWARE_WIRING_ASSISTANT.md) และมาตรฐานป้ายใน [WIRING_LABEL_STANDARD.md](WIRING_LABEL_STANDARD.md)

การทดสอบต้องใช้ OWNER/ADMIN, Unique Device Key, ไม่มี Active Table Session, Relay ทุกช่อง OFF และไม่มี Setup Mode, Wi-Fi provisioning, USB Flash หรือ Wiring Test อื่นทำงานพร้อมกัน ระบบไม่แก้ table mapping และไม่สั่งปิด Relay ทั้งหมดอัตโนมัติ

## Setup AP และการกู้คืน Wi‑Fi

ใช้ **สร้าง Setup Code** ขณะกล่องออนไลน์ก่อน รหัส Base31 จะแสดงเต็มเพียงครั้งเดียวและต้องยืนยันว่าได้จดเก็บแล้ว จากนั้นเมื่อจำเป็นให้ปิดโต๊ะทั้งหมดผ่าน workflow ปกติจน Relay ทุกช่อง OFF แล้วกด **โหมดกู้คืน Wi‑Fi**

เชื่อมต่อ `Lucky-Relay-xxxxx` ด้วย Setup Code และเปิด `http://192.168.4.1` ระบบไม่ปิด Relay ให้อัตโนมัติ Physical Setup Button ยังปิดเป็นค่าเริ่มต้นจนกว่าวงจร GPIO34 จะผ่าน acceptance ดูรายละเอียดที่ `docs/SPRINT_12D_SETUP_AP.md`

Hardware Manager จะไม่แสดงปุ่ม Restart จนกว่าอุปกรณ์จะประกาศ explicit capability ที่รองรับจริง ปัจจุบันการ restart ต้องกด `EN/RESET` หรือ power-cycle เท่านั้น และต้องตรวจว่า Relay ทุกช่อง OFF ก่อน

## ค้นหากล่องอัตโนมัติ

กด **ค้นหากล่องอัตโนมัติ** เพื่อค้นหาด้วย saved IP, mDNS, UDP และ bounded subnet fallback ระบบตรวจ Device ID และ REST API ก่อนแสดงผลเสมอ หาก Router เปลี่ยน IP ของกล่องเดิม ระบบจะอัปเดตเฉพาะ network location โดยรักษา record, Device Key และ table-to-relay mapping

หากค้นหาไม่พบ ให้กด **กรอก IP ด้วยตนเอง** เพื่อใช้ workflow เดิม ดูรายละเอียดที่ `docs/HARDWARE-DISCOVERY.md`

Hardware Manager เป็นหน้าจัดการ ESP32 Relay Controller ของ Lucky Snooker Manager การติดต่ออุปกรณ์ทั้งหมดเกิดจาก backend เท่านั้น Browser จะไม่เห็น API Key และไม่ติดต่อ ESP32 โดยตรง

## การเข้าใช้งาน

1. เข้าระบบด้วยบัญชี `OWNER` (หรือ `ADMIN` เมื่อระบบมีบทบาทนี้)
2. เลือก **Hardware Manager** จากเมนูด้านซ้ายก่อนเมนู **ตั้งค่า**
3. บัญชีบทบาทอื่นจะไม่เห็นเมนูและ backend จะตอบ `403`

## เพิ่ม ESP32

1. ตรวจว่า ESP32 และเครื่อง Server อยู่ในเครือข่ายที่ติดต่อกันได้
2. กด **เพิ่มอุปกรณ์**
3. สำหรับอุปกรณ์เดิมที่จัดการด้วยตนเอง ให้กรอกชื่อ, IPv4, Port และ Device Key เฉพาะกล่องที่ตั้งไว้แล้ว ห้ามใช้หรือแนะนำ shared/legacy key
4. Device Type ใช้ `RELAY_CONTROLLER`
5. กด **Test Connection** ระบบจะตรวจ `/api/v1/health`, `/api/v1/device` และ `/api/v1/config/relay`
6. เมื่อผ่านแล้วกด **Save** การบันทึกจะตรวจการเชื่อมต่อซ้ำเพื่อป้องกันข้อมูลอุปกรณ์ที่ใช้งานไม่ได้

Device Key เก็บเฉพาะใน `data/hardware-devices.json` ฝั่ง Server หน้าเว็บจะแสดงเพียง `••••••••` และการแก้ไขโดยเว้นช่องว่างจะรักษาค่าเดิม สำหรับ One-click New Install ระบบส่งต่อ key ภายใน Backend โดยผู้ใช้ไม่ต้องเห็น คัดลอก หรือกรอกเอง

## ตั้งค่าและทดสอบ Relay

- Relay Count รองรับเฉพาะ `2`, `4` หรือ `8`
- ปุ่ม ON/OFF ส่งผ่าน backend ซึ่งแปลงเป็นสัญญา firmware `{"state":"ON"}` หรือ `{"state":"OFF"}`
- ปุ่มช่องที่เกิน Relay Count หรืออุปกรณ์ Offline จะถูกปิด
- **ปิด Relay ทั้งหมด** สั่ง `/api/v1/relays/all/off` ผ่าน backend
- Firmware Sprint 11A ไม่มี Remote Restart ดังนั้นปุ่ม Restart จะแจ้งว่า firmware รุ่นนี้ยังไม่รองรับ โดยไม่มีการส่งคำสั่งที่ไม่มีอยู่จริง

## ผูก Relay กับโต๊ะ

ในส่วน **ผูก Relay กับโต๊ะ** เลือกอุปกรณ์และช่อง แล้วกดบันทึก ช่องเดียวกันของอุปกรณ์เดียวกันห้ามผูกซ้ำกับหลายโต๊ะ เมื่อตั้งค่าแล้ว ปุ่ม Relay ใน Dashboard และหน้าโต๊ะจะเรียกผ่าน HardwareService

- ยังไม่ผูก: ปุ่มถูกปิด พร้อมข้อความ “ยังไม่ได้ตั้งค่า Hardware”
- อุปกรณ์ Offline: ปุ่มถูกปิด พร้อมข้อความ “อุปกรณ์ Offline”
- Online: ใช้ปุ่มเปิด/ปิดได้ตามปกติ

## สถานะ

- **Online**: ติดต่ออุปกรณ์ล่าสุดสำเร็จ
- **Offline**: ติดต่อไม่ได้หรือหมดเวลา
- **Warning**: อุปกรณ์ตอบกลับแต่มีภาวะที่ต้องตรวจสอบ
- **Error**: ข้อมูลหรือการทำงานของอุปกรณ์ผิดปกติ

หน้า Hardware Manager ตรวจ Health ทุก 30 วินาทีเฉพาะตอนเปิดหน้านี้ และหยุด timer ทันทีเมื่อเปลี่ยนหน้า/ออกจากระบบ

## แก้ปัญหาเบื้องต้น

- **IP Address ไม่ถูกต้อง**: ใช้ IPv4 เช่น `192.168.1.50` ไม่ใส่ `http://`
- **เชื่อมต่อไม่ได้/Timeout**: ตรวจไฟเลี้ยง, Wi-Fi, IP, Port, Router และ Firewall
- **API Key ไม่ถูกต้อง**: ตรวจให้ตรงกับค่าที่ flash/configure ใน ESP32
- **API version ไม่รองรับ**: ต้องเป็น API v1 ตาม Sprint 11A
- **Relay Count ไม่ถูกต้อง**: เลือก 2, 4 หรือ 8 เท่านั้น
- **ช่องซ้ำ**: เลือกช่องอื่นหรือยกเลิกการผูกจากโต๊ะเดิมก่อน

หลังเพิ่ม route หรืออัปเดตไฟล์ Server ต้องหยุดและเริ่ม Node server ใหม่ด้วย `npm start` จากโฟลเดอร์ server

## สิ่งที่ต้องตรวจด้วย Hardware จริง

ตรวจการตัดต่อไฟจริงทุกช่อง, Active-Low และ Safe Boot, สัญญาณ Wi-Fi ในจุดติดตั้ง, การกลับมาหลังไฟดับ, ความร้อนของอุปกรณ์, All Off และพฤติกรรมเมื่อถอดสาย/Router/ESP32 ระหว่างใช้งาน
# Phase 3: Device Key และ Wi‑Fi

ก่อนเปลี่ยน Wi‑Fi ให้ใช้ปุ่ม **สร้างรหัสอุปกรณ์เฉพาะกล่อง** ก่อน ระบบจะไม่ยอมดำเนินการกับ bootstrap key จากนั้นปิดโต๊ะทุกโต๊ะผ่านขั้นตอนปกติจน Relay ทุกช่องเป็น OFF แล้วจึงใช้ปุ่ม **เปลี่ยนเครือข่าย Wi‑Fi**

ระบบจะไม่สั่งปิด Relay ให้อัตโนมัติ และจะบอกหมายเลขช่องที่ยังเปิดอยู่ การบันทึก IP ใหม่เกิดขึ้นหลังพบ Device ID เดิมและตรวจ nonce/HMAC สำเร็จเท่านั้น ดูรายละเอียดและข้อควรระวังด้าน secret storage ที่ `docs/SPRINT_12C_WIFI_PROVISIONING.md`
# Automatic Hardware Health (Phase 5.4B)

Hardware Manager ตรวจสุขภาพอัตโนมัติทุก 15 วินาทีขณะเปิดหน้า และ Backend ตรวจทุก 60 วินาที หน้า Card แสดงสถานะพร้อมข้อความ, Last seen, Last checked, Firmware, Relay Count, RSSI, Uptime, latency และ failure count การ timeout หนึ่งครั้งไม่ทำให้ Offline; ต้องล้มเหลวต่อเนื่อง 3 ครั้ง และเมื่อกล่องกลับมาตอบครบ contract จะกลับ Online อัตโนมัติ

การตรวจนี้เป็น read-only และไม่เปลี่ยน Relay, Wi-Fi, mapping หรือ identity ปุ่ม “ทดสอบ/รีเฟรช” มี cooldown 3 วินาที
