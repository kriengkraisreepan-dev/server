# Phase 5.4B — Hardware Health Monitoring

## Architecture

`HardwareHealthMonitoringService` เรียกเฉพาะ public `GET /api/v1/health` ผ่าน HAL เดิม ไม่ส่ง Device Key และไม่เรียก Relay, restart, Wi-Fi, provisioning หรือ Setup API

Backend ตรวจอุปกรณ์ทุก 60 วินาที ส่วนหน้า Hardware Manager ขอรอบตรวจทุก 15 วินาที มี request timeout 5 วินาที, stale threshold 90 วินาที, offline threshold 3 ครั้ง, manual cooldown 3 วินาที และตรวจพร้อมกันไม่เกิน 4 กล่อง การตรวจอุปกรณ์เดียวกันที่ซ้อนกันใช้ Promise เดียว ระบบปิด background timer เมื่อ Server shutdown

ปิด automatic monitoring เพื่อ rollback ได้ด้วย environment variable `LUCKY_HARDWARE_HEALTH_POLLING=0` โดย manual Hardware workflow เดิมและ record ทั้งหมดยังคงอยู่

## Status

- `ONLINE`: JSON contract ถูกต้อง, Device ID/Relay Count ตรง และ Wi-Fi connected
- `CHECKING`: กำลังตรวจ
- `STALE`: ไม่มีผลใหม่เกิน 90 วินาที
- `TIMEOUT`: ครั้งล่าสุดหมดเวลาแต่ยังไม่ครบ threshold
- `OFFLINE`: ล้มเหลวต่อเนื่องอย่างน้อย 3 ครั้ง
- `UNKNOWN`: หลักฐานไม่พอหรือพบ identity/configuration mismatch

Mismatch ไม่แก้ Device ID, Relay Count หรือ IP mapping และไม่สร้าง Hardware record ใหม่

## Recovery และ persistence

เมื่อกล่องกลับมาตอบครบ contract ระบบเปลี่ยนเป็น ONLINE, อัปเดต `lastSeen`, `lastOnlineAt`, `lastCheckedAt`, firmware/health metrics/latency และล้าง failure count ผ่าน HardwareRepository ซึ่งเขียน JSON แบบ atomic และ rollback in-memory state หากบันทึกล้มเหลว

ข้อมูลที่เก็บไม่มี secret: status, timestamps, error code, failure count, firmware version, relay count, RSSI, uptime, heap และ latency

## Logs

รองรับ `HARDWARE_HEALTH_CHECK_STARTED`, `HARDWARE_HEALTH_CHECK_SUCCEEDED`, `HARDWARE_HEALTH_CHECK_TIMEOUT`, `HARDWARE_STATUS_CHANGED`, `HARDWARE_STATUS_RECOVERED` และ `HARDWARE_IDENTITY_MISMATCH` โดยไม่บันทึก Device Key, header, Setup Code, Wi-Fi credential หรือ HMAC material และไม่ audit success ปกติที่สถานะไม่เปลี่ยน

## Manual acceptance

สถานะยังเป็น PENDING จนกว่าจะทดสอบกล่องที่ถอดโหลดไฟบ้านและ Relay ทุกช่อง OFF ตาม `HARDWARE_ACCEPTANCE.md` ห้ามทดสอบโดยถอดไฟกล่องที่ควบคุมโต๊ะใช้งานจริง

## Rollback

ตั้ง `LUCKY_HARDWARE_HEALTH_POLLING=0`, ถอด health routes/UI polling และคืนปุ่ม manual เดิม ไม่ต้อง migrate database, ลบ record, เปลี่ยน Device Key หรือแก้ Firmware

## IP auto-heal (DHCP address changes)

กล่องได้ IP จาก router ผ่าน DHCP เมื่อ router รีสตาร์ตหรือ lease หมด IP อาจเปลี่ยนและการ์ดโต๊ะจะขึ้น "อุปกรณ์ Offline" ทั้งที่กล่องปกติ

- `HardwareHealthMonitoringService` เรียก hook `onUnreachable` เมื่อตรวจไม่ผ่านติดกัน ≥ 2 ครั้ง (หรือพบ deviceId ไม่ตรงที่ IP เดิม)
- `HardwareIpHealerService` รัน Discovery (saved IP → mDNS → UDP → สแกน /24 จนเจอทุกกล่อง) ครั้งละหนึ่งรอบเท่านั้น backoff 1 → 2 → 5 → 10 → 15 นาที
- ถ้าเจอ deviceId เดิมที่ IP ใหม่ จะอัปเดตเฉพาะ IP/port ของ record เดิม (ไม่เปลี่ยนการผูกโต๊ะ/relay และไม่ส่ง Device Key ไปยัง address ที่ยังไม่ยืนยัน) แล้วตรวจสุขภาพทันทีเพื่อ reconcile ไฟโต๊ะ
- Audit: `HARDWARE_IP_AUTO_HEALED` (previousIp/newIp), `HARDWARE_IP_HEAL_NOT_FOUND` (ครั้งเดียวต่อช่วงที่หาย — แปลว่ากล่องดับ/ไม่อยู่ใน Wi-Fi ไม่ใช่ปัญหา IP)
- ปิดได้ด้วย `LUCKY_HARDWARE_AUTO_HEAL=0` หรือปิด `settings.hardware.discoveryEnabled`
- แนะนำเสริม: ตั้ง DHCP reservation ของกล่องที่ router (ผูก MAC → IP คงที่) เพื่อไม่ให้ IP เปลี่ยนตั้งแต่ต้น
