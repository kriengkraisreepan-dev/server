# Lucky Updater Architecture — Sprint -1

## Current state

No Electron app, installer, updater, program/data separation, or update-signing implementation exists today. The current `data/` location is under the source/application directory and must not be retained as the future production data location.

## Target Windows layout

```text
Program Files\Lucky Snooker Manager\     # signed application binaries/assets; updater may replace
%LOCALAPPDATA%\Lucky Snooker Manager\    # Electron app.getPath('userData') equivalent
  database\
  backups\
  config\
  license\
  logs\
  uploads\
  update-staging\
```

When Electron is introduced, its main process owns user-data path resolution via `app.getPath('userData')`; renderer code never receives arbitrary filesystem access. Installer/updater must not write customer SQLite database, license, config, backups, logs, or uploads.

## Update transaction

1. Verify manifest version, target platform, application-version eligibility, package hash, and a vendor signature.
2. Create and verify a User Data backup; record installed version and update attempt in logs.
3. Download or receive a signed package into staging; validate before extraction.
4. Stop the main application gracefully, preserving DB integrity.
5. Extract/replace only Program Files into a versioned staging/previous directory.
6. Run database migrations against User Data using the migration runner.
7. Perform a smoke check and start Lucky Snooker Manager.
8. Mark success, then remove temporary staging only after success.

On any failure, restore the prior program directory and restore/repair the pre-migration database backup. The updater must be a small separate executable so it can replace the main app after it exits.

Package manifests should include version, file list, cryptographic hashes, minimum supported data/schema version, migration identifiers, release notes, and an Ed25519 signature. Use a separate update-signing key from the license-signing key.
