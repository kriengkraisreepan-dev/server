# Phase 5.5 — Manual Acceptance

สถานะทั้งหมด: `PENDING`

- Windows 10 22H2 x64: install-free portable start, Standard User, LocalAppData, read-only package, backup/restore, single instance, COM/USB
- Windows 11 x64: รายการเดียวกันและ health recovery
- ESP32 อย่างน้อย 2 กล่อง: online Wi-Fi change, USB Wi-Fi recovery, COM number change, Setup Code reauthentication, Add/Replace, restart mapping, multi-device isolation

Hardware test ต้องถอดโหลดไฟบ้านและ Relay ทุกช่อง OFF ห้ามใช้ข้อมูลร้านจริง Production Private Key, Installer และ Phase 6B/6C/7 ยังคงไม่เริ่ม
# Defect 04 — Existing ESP32 USB Adoption

เมื่อ Wizard พบกล่อง Firmware 1.2.0 แต่ไม่มี Hardware record/vault ใน Customer Data ให้ใช้ workflow “เพิ่มกล่องนี้ผ่าน USB” ตาม [PHASE5_5_EXISTING_USB_ADOPTION.md](PHASE5_5_EXISTING_USB_ADOPTION.md) ห้าม Flash ซ้ำ ห้ามเลือก New Install และห้ามกรอก Device Key

# Defect 05 — USB Adoption Preflight

Revision 7 แยกข้อผิดพลาด preflight ตามขั้น COM validation, IDENTIFY, GET_RELAY_SAFETY, identity/version/count, duplicate check และ token creation หากขั้นใดล้มเหลวต้องไม่เรียก adoption start และไม่ใช้ Setup Code attempt ดู [PHASE5_5_MANUAL_DEFECT_05_RESOLUTION.md](PHASE5_5_MANUAL_DEFECT_05_RESOLUTION.md)
