# Reproducible Lucky-built NVS generator

Pinned inputs: ESP-IDF `v4.4.7` (`38eeba213aa695aabfd6d89aa9f5078dbe5a94c3`), Python `3.12.13`, PyInstaller `6.11.1`, and the dependency inventory recorded in `PROVENANCE.json`. Build only on an isolated Windows x64 release worker. The resulting executable is a Lucky-built distribution, not an official Espressif binary.

The release worker downloads `nvs_partition_gen.py` and ESP-IDF LICENSE from the pinned tag, verifies their recorded SHA-256 values, installs the exact dependency lock, and runs:

```powershell
python -m PyInstaller --clean --noconfirm --onefile --name lucky-nvs-generator nvs_partition_gen.py
```

Never use Python from PATH on the shop computer. Only the resulting signed-and-hashed executable enters the portable package. A distribution/license review is required before production use.
