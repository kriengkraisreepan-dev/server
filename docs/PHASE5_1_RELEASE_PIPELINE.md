# Phase 5.1 — Test Release Pipeline

เอกสารนี้อธิบาย Test Package เท่านั้น ยังไม่อนุญาตให้ Flash hardware หรือใช้ Production signing key

## สิ่งที่ระบบทำอัตโนมัติ

1. ใช้ firmware artifacts จริงจาก `firmware/.pio/build/esp32dev`
2. ตรวจว่า `firmware.bin` ไม่มี shared bootstrap SSID/password/Device Key เดิม
3. คำนวณ SHA-256 และขนาดทุก release asset
4. สร้าง canonical `manifest.json` ที่เรียง key แบบ deterministic
5. สร้าง ephemeral Ed25519 Test key และเขียนเฉพาะ public key นอก package
6. เซ็นเป็น `manifest.sig` และตรวจซ้ำด้วย `FirmwarePackageService`
7. สร้าง package แบบ temporary directory แล้ว rename เมื่อทุกขั้นผ่าน
8. ลบ package ชั่วคราวเมื่อเกิดข้อผิดพลาด

คำสั่งสร้าง Test Package:

```powershell
node scripts\build-phase5_1-test-package.js
```

ผลลัพธ์อยู่ที่ `runtime/firmware-packages/test/<firmware-version>` ซึ่งถูก ignore จาก Git ส่วน Test private key อยู่ใน memory เท่านั้นและไม่ถูกเขียนลง disk

## ขอบเขตความเชื่อถือ

Signed base manifest รับรอง firmware, esptool, Lucky-built NVS generator, schema, offset, size และ secret policy ส่วน per-device NVS สร้างภายหลังและผูกกับ operation ผ่าน SHA-256 authorization ใน memory อายุ 120 วินาที Backend ตรวจ hash/size/path ซ้ำก่อนสร้าง argument array ให้ esptool

Production mode ปฏิเสธ `releaseChannel: test` และ `signingEnvironment: test` เสมอ การเปลี่ยนเป็น production ในอนาคตต้องติดตั้ง production public key และเซ็นจาก release environment ภายนอก repository ห้ามเปลี่ยน channel ใน Test manifest แล้วเซ็นด้วย Test key

## สิ่งที่ยังต้องทำด้วย hardware

- ยืนยัน NVS image กับ ESP32 Preferences จริง
- ยืนยัน Existing Update รักษา NVS เดิมครบ
- ทดสอบ CP210x และ CH340/CH341
- ทดสอบ power loss/recovery

