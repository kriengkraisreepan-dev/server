# Phase 5.5 Internal Portable Revision 3 — Firmware Package

Revision 3 embeds a signed `internal-test` Firmware 1.2.0 package and its public Ed25519 verification key. The signing private key is generated ephemerally during the internal build and is never written into the package. Production signing material is not used.

Existing Update writes only `firmware.bin` at `0x10000`. `boot_app0.bin` is not part of the locked ESP32 flash contract. Before writing, the Backend reads and hashes NVS at `0x9000` for `0x5000` bytes. After restart it reads NVS again and requires the hash to match, then verifies Firmware 1.2.0, API version, Device ID, Relay Count, and all Relay channels OFF through the fixed serial recovery protocol.

If any verification fails, the operation reports `FAILED` and does not create a Hardware record. Existing Update never starts enrollment. For the current test controller select “อัปเดตกล่องเดิม — รักษาการตั้งค่าทั้งหมด”; never select New Install.
