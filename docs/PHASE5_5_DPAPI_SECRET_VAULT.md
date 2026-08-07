# Phase 5.5 — DPAPI Hardware Secret Vault

`hardware-devices.json` เก็บ `secretId` เท่านั้น Device Key ciphertext อยู่ `config/hardware-secrets.dpapi.json` และป้องกันด้วย Windows DPAPI `CurrentUser` ซึ่งผูกกับบัญชี Windows ที่รัน Backend

Migration: protect plaintext → atomic vault write → unprotect/verify → atomic record write → ตรวจและลบ `.bak`, `.tmp-*`, `.corrupt-*` ที่ยังพบ field `apiKey` เท่าที่ทำได้ หาก vault/reference/decryption เสียจะ fail closed

ข้อจำกัด: atomic replace และ filesystem อาจทิ้งข้อมูลใน free space, snapshots หรือ storage history จึงไม่อ้างว่า secure erase สำเร็จ Same-machine backup ต้องรักษา DPAPI vault และ Windows account context ส่วน portable export ห้ามรวม ciphertext/reference/key และบังคับ Hardware records เป็น `REAUTHENTICATION_REQUIRED`
