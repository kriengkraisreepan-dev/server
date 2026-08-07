# Lucky Updater Architecture

## Phase 6A implemented boundary

Phase 6A implements Electron process isolation and Program/Customer Data separation only. It prepares `%LOCALAPPDATA%\Lucky Snooker Manager\update-staging` but does not download, install or replace application code.

```text
Program Files\Lucky Snooker Manager\     # future signed application binaries/assets
%LOCALAPPDATA%\Lucky Snooker Manager\
  database\
  backups\
  config\
  license\
  logs\
  uploads\
  update-staging\
  migration\
  runtime\
```

Electron Main owns data-root resolution. Renderer code has no filesystem access and cannot choose paths. Installer/updater work must never overwrite customer database, license, config, backups, logs, uploads or migration evidence.

## Future Phase 6C design (not implemented)

1. Verify manifest version, platform, application eligibility, file hashes and vendor signature.
2. Create and verify a Customer Data backup and record the attempt in redacted logs.
3. Receive an approved signed package into `update-staging`; validate before extraction.
4. Stop the application gracefully and preserve data integrity.
5. Replace only Program Files through versioned staging/previous directories.
6. Run separately approved data migrations against Customer Data.
7. Perform a smoke check and start the program.
8. Commit success; remove temporary staging only after verification.

On failure, restore the prior program version and use verified data recovery. A future updater should be a small separate executable and use an update-signing key distinct from license signing.

No auto update, Internet update, OTA, rollback executable, installer, package distribution or signing key was created in Phase 6A.
