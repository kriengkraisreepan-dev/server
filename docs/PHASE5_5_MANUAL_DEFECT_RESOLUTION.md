# Phase 5.5 Manual Acceptance Defect Resolution — Revision 2

Revision 2 fixes Backup Save As and removes browser-supplied Device Keys from the packaged Hardware Setup Wizard. It does not change firmware, Relay state, GPIO mapping, billing, POS, or production deployment policy.

Electron now exposes one fixed preload operation accepting only an allowlisted backup filename. Main validates the sender, trusted backup directory, regular-file status, link/path safety, JSON/checksum, and portable-secret policy before opening Windows Save As. The destination uses a temporary file, flush, rename, size verification, and SHA-256 verification. Cancel returns `CANCELLED`; the source remains unchanged.

The production-like/Internal Test runtime removes the credential control from Wizard Step 4 before interaction. The replacement request carries confirmation flags only. Backend authentication resolves exactly one matching Hardware record and uses its DPAPI-vault secret. Missing, ambiguous, migrated, or reauthentication-required records fail closed to USB. New-install enrollment remains bound to its pending enrollment transaction.

Manual Windows 10 and Windows 11 acceptance must restart from the beginning with Revision 2. Hardware Flash and Hardware Acceptance remain blocked until that rerun passes.
