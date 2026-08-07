# Phase 6A — Electron Security

BrowserWindow ล็อก `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`; preload เป็น absolute trusted path และ production-like ปิด DevTools

IPC allowlist มีเพียง app info และ runtime status ไม่มี payload, path, command, port หรือ credential จาก Renderer ทุก sender ต้องเป็น runtime loopback origin เดียวกัน Permission requests, webview, external navigation และ arbitrary `window.open` ถูกปฏิเสธ

CSP เป็น deny-by-default: script เฉพาะ self, connect เฉพาะ self/runtime origin, object/base/frame ปิด และไม่มี `unsafe-eval` ปัจจุบัน UI เดิมมี inline style จำนวนมาก จึงคง `style-src 'self' 'unsafe-inline'` ชั่วคราว นี่คือ residual risk; ต้องย้าย inline styles เข้า stylesheet ก่อนถอด policy นี้ใน phase hardening แยก

Operational logs redact password, Device Key, Setup Code, session token และ proof; migration manifest เก็บเฉพาะ metadata/hash
