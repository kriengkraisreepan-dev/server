# Production Release Procedure

ขั้นตอนนี้ยังห้ามใช้จนกว่า Production Key Ceremony, public-key enrollment และ distribution acceptance จะลงนามครบ

1. Developer ส่ง source commit ที่ review แล้วและ Firmware SemVer
2. Release Operator ตรวจ working tree, build inputs, PlatformIO 6.9.0, Arduino ESP32 core 3.20017.241212, esptool 4.11.0 และ NVS generator `esp-idf-v4.4.7+lucky.1`
3. Production Approver ตรวจ license, antivirus, Windows execution, CP210x, CH340/CH341 และ ESP32 hardware acceptance
4. บันทึก confirmations ของสองบทบาทแยกกัน
5. บน isolated offline release worker เสียบ encrypted key media ชุดหลัก อ่าน private keyผ่าน explicit key provider โดยไม่ส่ง key ใน arguments, environment, log หรือไฟล์ชั่วคราว
6. Builder อ่าน artifacts จากตำแหน่งที่ล็อก สร้าง temporary directory, hashes, `PROVENANCE.json`, Release Notes และ manifest v2
7. ลงนาม detached Ed25519 แล้วตรวจซ้ำด้วย embedded allowlist
8. Publish ด้วย atomic rename ไป `runtime/firmware-packages/production/<version>/<buildId>` ห้าม overwrite
9. Secret scan, antivirus scan และ package acceptance จาก Production Approver
10. Archive package, manifest, signature, public key/ID, provenance, notes, approvals และ notices ตลอดอายุผลิตภัณฑ์บวกอย่างน้อย 5 ปี

หากขั้นใดล้มเหลว temporary workspace ต้องถูกลบและห้ามเหลือ partial release ห้ามแก้ manifest หลัง signing ห้ามใช้ Browser เลือก key, input, output หรือ flash arguments

Production-like verification ใช้คำสั่ง `npm run build:phase5.3-test` ซึ่งสร้าง ephemeral key ใน memory และไม่ใช่ Production release
