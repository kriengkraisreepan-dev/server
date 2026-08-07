# Phase 5.5 — Portability & Hardware Lifecycle Stabilization

สถานะ implementation: automated implementation complete; Windows 10/11 และ Hardware acceptance ยัง `PENDING`

## Decision Gates

- DPAPI Hardware Secret Vault: APPROVED/IMPLEMENTED
- USB Transactional Device Key Rotation: APPROVED/IMPLEMENTED
- Internal Portable Test Package: APPROVED/IMPLEMENTED
- Production Private Key/Installer/Phase 6B/6C/7: NOT STARTED

รองรับเป้าหมาย Windows 11 x64 และ Windows 10 22H2 x64 compatibility โดย runtime ใช้ Standard User, Backend bind `127.0.0.1`, Customer Data อยู่ LocalAppData และ Program/runtime package ไม่รับ customer data จริง

Online Wi-Fi change เดิมยังใช้ candidate 30 วินาที, commit 90 วินาที, rediscovery 60 วินาที, nonce/HMAC และ relay-safe guard โดยไม่มี automatic all-off

USB Recovery ใช้ fixed request/response contract เท่านั้น ไม่มี debug shell และไม่แก้ Relay, Device ID, Setup Code, Relay Count หรือ GPIO mapping Firmware 1.2.0 เพิ่ม `IDENTIFY`, `GET_RELAY_SAFETY`, Wi-Fi transaction และ Device Key rotation commands ที่อนุมัติ

Add ESP32 ยังคงใช้ One-click New Install/enrollment handoff เดิม ส่วน Replace ESP32 ตรวจ identity, credential, Relay Count และ Relay OFF ทั้งกล่องเก่า/ใหม่ก่อนย้าย table mapping แล้ว archive กล่องเดิมเป็น `REPLACED_ARCHIVED`
