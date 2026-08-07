# Third-party Distribution Checklist

รายการนี้เป็น engineering inventory ไม่ใช่คำวินิจฉัยทางกฎหมาย ต้องมี distribution review ก่อน Production release

- [x] ESP-IDF NVS generator v4.4.7, Apache-2.0, tag/commit/source/hash recorded
- [x] Python 3.12.13 license included
- [x] PyInstaller 6.11.1 license/bootloader exception included
- [x] cryptography 49.0.0 Apache/BSD licenses included
- [x] esptool 4.11.0 GPL-2.0-or-later license, official release URL and SHA-256 recorded
- [x] esptool corresponding-source URL recorded
- [x] Lucky-built generator identified as non-official binary
- [x] Test Package contains `THIRD-PARTY-NOTICES.txt` and `LICENSES/`
- [ ] Legal/distribution owner review completed
- [ ] Antivirus/signing acceptance completed
- [ ] Production public key installed
- [ ] Hardware acceptance completed

Phase 5.3 gate ยังคงเป็น `PRODUCTION DISTRIBUTION NOT YET APPROVED` จนกว่ารายการ Legal/distribution, antivirus, Windows execution, CP210x, CH340/CH341, ESP32 hardware และ Production Approver sign-off จะครบทั้งหมด

Provenance อยู่ที่ `tools/phase5_1/PROVENANCE.json` และวิธี build อยู่ที่ `tools/phase5_1/BUILD.md`
