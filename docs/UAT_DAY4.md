# UAT Day 4 — Member, Reports, Backup and Restore

วันที่ทดสอบ: __________  Build: __________  Backup ID: __________

| Test case | Expected result | Actual result | Pass/Fail | Operator | Date | Remark |
|---|---|---|---|---|---|---|
| D4-01 Create/select member | ค้นหาและผูกสมาชิกถูกคน | | □ Pass □ Fail | | | |
| D4-02 Earn table-time points | แต้มตรงเวลาและ policy | | □ Pass □ Fail | | | |
| D4-03 Redeem points | ส่วนลดและแต้มคงเหลือถูกต้อง | | □ Pass □ Fail | | | |
| D4-04 Double redeem attempt | ใช้แต้มกับรายการเดิมซ้ำไม่ได้ | | □ Pass □ Fail | | | |
| D4-05 Reports | ยอดตรง paid bills และ settlement | | □ Pass □ Fail | | | |
| D4-06 Create backup | VERIFIED, checksum, fileCount=3 | | □ Pass □ Fail | | | |
| D4-07 Restore dry-run | RESTORABLE/WARNING โดยไม่เปลี่ยนข้อมูล | | □ Pass □ Fail | | | |
| D4-08 Actual restore | มี pre-restore backup และข้อมูลกลับครบ | | □ Pass □ Fail | | | |
| D4-09 Health endpoint | JSON ถูกต้อง ไม่มี secret และไม่ CRITICAL | | □ Pass □ Fail | | | |
| D4-10 Integrity endpoint | PASS/WARNING และไม่มี ERROR ที่ไม่อธิบาย | | □ Pass □ Fail | | | |

ผู้สรุป: __________  □ ผ่านทั้งวัน  □ มี issue ต้องแก้  Issue IDs: __________
