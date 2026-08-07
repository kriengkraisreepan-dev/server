# Phase 5.4A — Display Preferences & UI Scaling

## Closeout Status

```text
Implementation: CLOSED — 2026-08-04
Architecture/Decision Gate: COMPLETE / PASS
Automated focused tests: 8/8 PASS
Full regression at closeout: 187/187 PASS
Backend/API changes: NONE
Firmware build: NOT REQUIRED
Manual Browser Acceptance: COMPLETE — user attestation 2026-08-04
```

การปิด Phase นี้หมายถึงปิดขอบเขต implementation และห้ามเพิ่ม feature ต่อโดยไม่มี Decision Gate ใหม่ Manual Browser Acceptance ได้รับการยืนยันจากผู้ใช้งานเมื่อวันที่ 2026-08-04 โดย Codex ไม่ได้อ้างว่าเป็นผู้ตรวจภาพด้วยตนเอง

## ขอบเขต

Phase นี้เพิ่มการตั้งค่าหน้าจอเฉพาะ Browser โดยไม่แก้ Backend, ฐานข้อมูล, Backup, Hardware API, Firmware หรือ Production signing

## Decision Gate

- CSS เดิมเป็น stylesheet กลางแบบ compact มี root variables บางส่วนและสี hardcode ใน component เฉพาะ จึงใช้ semantic override layer แยกไฟล์เพื่อหลีกเลี่ยง mechanical replacement
- Settings เป็น SPA renderer ที่ต่อเติมแบบ additive; display controls จึงไม่อยู่ใน form/payload การตั้งค่าร้าน
- localStorage เดิมใช้กับ POS context เท่านั้น Reset ใหม่ลบเฉพาะ namespace `lucky.display.*`
- ไม่พบ Content Security Policy ที่ห้าม external bootstrap script และไม่ได้เพิ่ม inline bootstrap
- Print เดิมมี receipt popup และ Wiring Sheet rules; override ใหม่คง isolated printable content และคืน scale 100%
- Modal ใช้ overlay กลางหนึ่งชุด; เพิ่ม bounded height/overflow โดยไม่เปลี่ยน open/close workflow
- หน้าที่เสี่ยง overflow คือ Bill History, Reports, Hardware mapping, Wizard, Flasher และ Wiring Assistant; ใช้ container overflow โดยไม่แก้ข้อมูลหรือ workflow
- Browser target: Chrome/Edge รุ่นที่ใช้งานปัจจุบันบน Windows; Safari/iOS และ Android mobile UI เดิมต้องไม่เสีย แต่ Phase นี้ไม่ได้ redesign mobile/Captive Portal
- ไม่พบ conflict ที่ต้อง redesign ระบบหลัก Decision Gate จึงผ่านสำหรับ implementation แบบ additive

## ค่าที่รองรับ

- Theme: `dark` (ค่าเริ่มต้น), `light`, `system`
- UI scale: `small` 90%, `normal` 100% (ค่าเริ่มต้น), `large` 110%, `xlarge` 125%
- Storage keys: `lucky.display.theme` และ `lucky.display.scale`

ค่าทั้งหมดผ่าน allowlist เท่านั้น ค่าที่เสียหายจะกลับเป็น dark/normal และไม่รับ arbitrary CSS, class หรือ percentage

## พฤติกรรม

ไฟล์ bootstrap ถูกโหลดก่อน stylesheet เพื่ออ่านค่าและกำหนด DOM attributes ก่อนวาดหน้า เมื่อเลือก `system` ระบบใช้ `prefers-color-scheme` และติดตามการเปลี่ยนธีมระหว่างเปิดหน้า โดยป้องกัน listener ซ้ำ หาก localStorage ถูกบล็อก ผู้ใช้ยังเปลี่ยนค่าใน session ปัจจุบันได้และ UI จะแจ้งว่าไม่สามารถบันทึกถาวร

ปุ่มคืนค่าเริ่มต้นลบเฉพาะสอง key ข้างต้น ไม่ลบ authentication, POS context หรือข้อมูลอื่น

## Layout, print และ accessibility

- Scale ใช้ full-page CSS layout zoom ที่ root เพื่อให้ sidebar, card, grid, table, modal, ระยะห่าง, input และปุ่มเปลี่ยนขนาดพร้อมกัน โดยไม่ใช้ `transform: scale()`
- Modal มี bounded height และ scroll ภายใน
- container ที่มีตารางรองรับ horizontal overflow
- `@media print` บังคับ scale 100%, พื้นขาว ตัวอักษรดำ และซ่อน navigation/control
- มี `:focus-visible`, disabled state และ semantic color tokens ทั้ง dark/light
- WCAG AA และความครบถ้วนเชิงภาพทุกหน้าต้องยืนยันใน Manual UAT; automated tests ไม่ถือเป็นหลักฐาน visual acceptance

## Manual acceptance

ทดสอบ dark/light/system→dark/system→light และ scale ทั้งสี่ระดับที่ 1366×768 และ 1920×1080 ตาม `docs/MANUAL_UAT_MATRIX.md` โดยใช้ข้อมูลทดสอบ ห้ามทำธุรกรรมเงินจริง

## Rollback

1. ถอด `js/display-preferences.js` และ `css/display-preferences.css` จาก `public/index.html`
2. ถอด Display Preferences renderer/binding ที่ท้าย `public/js/app.js`
3. ลบสองไฟล์ดังกล่าวและคืน root attributes เป็นค่า dark เดิม
4. ไม่ต้อง migrate database, Backup หรือ Firmware; localStorage ที่เหลือถูกละเว้นอย่างปลอดภัย
