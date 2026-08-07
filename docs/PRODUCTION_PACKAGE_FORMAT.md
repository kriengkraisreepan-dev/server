# Production Package Format v2

## Exact allowlist

```text
manifest.json
manifest.sig
bootloader.bin
partitions.bin
firmware.bin
esptool.exe
lucky-nvs-generator.exe
PROVENANCE.json
RELEASE_NOTES.md
THIRD-PARTY-NOTICES.txt
LICENSES/**
```

`LICENSES/**` ต้องเป็น regular non-executable files ชั้นเดียว ห้าม symlink, nested directory, path traversal หรือ executable เพิ่มเติม ทุกไฟล์ยกเว้น manifest/signature ต้องปรากฏหนึ่งครั้งใน `files` พร้อม unique path/role, byte size และ lowercase SHA-256

## Manifest contract

Manifest เป็น canonical UTF-8 JSON ไม่มี whitespace ที่ไม่จำเป็น และอนุญาต exact required keys เท่านั้น:

| Field | Type/contract |
|---|---|
| `manifestFormatVersion` | integer `2` |
| `product` | `Lucky Relay Controller` |
| `releaseChannel` | `production` |
| `signingEnvironment` | `production` หรือ `production-like-test` เฉพาะ test verifier |
| `signingKeyId` | `lrc-prod-YYYY-NN-<12 HEX>` ตรง SPKI fingerprint |
| `firmwareVersion`, `minimumManagerVersion` | strict SemVer `MAJOR.MINOR.PATCH` |
| `apiVersion`, `hardwareStandard` | `1`, `LHS-1.0` |
| `targetChip`, `boardProfile`, `flashSizeBytes` | `ESP32`, `esp32dev-4mb`, `4194304` |
| `partitionLayoutVersion` | integer `1` |
| `buildId` | `prod-` + application SHA-256 prefix |
| `sourceCommit` | Git commit 40 hex |
| `createdAt` | ISO-8601 UTC timestamp |
| `toolchain` | exact approved PlatformIO/core/compiler versions |
| `esptool`, `nvsGenerator` | exact role/path/version/source/hash/size contracts |
| `distributionAssets` | paths ของ provenance, notes, notices และ licenses |
| `files` | unique exact file inventory |
| `existingUpdate` | application `0x10000` เท่านั้น |
| `newInstall` | bootloader `0x1000`, partitions `0x8000`, session NVS `0x9000`, application `0x10000` |
| `nvsPolicy` | namespace/size/relay counts/secret-generation contract |

Detached signature คือ Ed25519 64 bytes เข้ารหัส canonical Base64 ใน `manifest.sig`. Signature, hash, target, layout, version และ trust validation fail closed

Downgrade ถูกปฏิเสธ Same version รับเฉพาะ build ID และ application hash เดิม Recovery downgrade ไม่มีใน Phase นี้
