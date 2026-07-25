# Sprint 0 — Data Foundation & SQLite Preparation

## What was added

```text
config/paths.js                         Future user-data path resolution; not used by runtime yet
database/database.js                    SQLite connection boundary
database/migration-runner.js            Ordered/checksummed transactional migration runner
database/migrations/001_initial_schema.sql
database/validation/json-store-validator.js
database/repositories/legacy-import-repository.js
database/services/import-service.js     Service boundary for future route/IPC callers
database/json-importer.js               JSON validation, staged import, verification, atomic publish
database/backup.js                      Manifest/checksum backup utility for JSON or SQLite files
scripts/import-json-to-sqlite.js        Explicit CLI; requires --dry-run or --confirm
```

None of these files is imported by `index.js`. Existing Express routes, JSON store, API contract, browser UI and current backup behaviour are unchanged.

## Layering

```text
Future Route / Electron IPC
  -> database/services/import-service
  -> database/json-importer
  -> validation + repositories
  -> database/database + migration-runner
  -> SQLite
```

Routes must not call SQLite or repository SQL directly. This is a foundation boundary, not a switch of the existing runtime.

## Migration and recovery policy

- Migrations are immutable files named `NNN_description.sql`, sorted numerically.
- `schema_migrations` stores version, name, SHA-256 checksum and applied time.
- Each migration runs in `BEGIN IMMEDIATE` / `COMMIT`; failure attempts rollback and stops.
- A changed checksum of an applied migration is fatal; write a new forward migration instead.
- Production migration requires a verified User Data backup first. If it fails, restore the database backup and retain logs; never drop a table automatically.
- Rollback of production changes is recovery from verified backup by default. Later migrations may have explicitly tested down/recovery procedures, but historical migration files are never edited.

## Import strategy and safety

1. Read source JSON only and validate structure/duplicates/references.
2. `--dry-run` produces a report with no SQLite file.
3. A real import refuses an existing target path.
4. Create and migrate a uniquely named temporary database in the target directory.
5. Import everything in a transaction; run integrity, foreign-key and count checks.
6. Close and atomically rename temporary database only after verification.
7. On failure, delete only newly-created temporary artifacts; never alter JSON or an existing target database.

The current migration is intentionally not called during application start. A later cutover sprint must require a user-approved, backup-first migration.

## Backup and User Data strategy

`database/backup.js` creates a timestamped copied file plus a SHA-256 manifest and can verify it. During transition, retain existing JSON backups and create separate SQLite backups; do not mix their restore paths. Future runtime locations are resolved from `LUCKY_USER_DATA_DIR` or the Windows application-data directory as `Lucky Snooker Manager/{database,backups,config,license,logs,uploads,update-staging}`. No directories are created by the active app in this sprint.

## Configuration strategy

`config/paths.js` is the single future runtime-path resolver. `LUCKY_USER_DATA_DIR` supports development/test isolation. Future Electron code should pass its `app.getPath('userData')` result through this layer rather than allowing renderer-controlled paths. Existing `data/` remains untouched until a dedicated cutover.

## Risks

| Risk | Control in Sprint 0 | Remaining work |
|---|---|---|
| Corrupt/invalid JSON | pre-import validation and dry-run | versioned JSON backup format |
| Existing SQLite overwrite | hard refusal when target exists | operator UX and backup selection |
| Partial import | temporary target + transaction + verification | production recovery UI |
| Broken historical references | warning plus preserved snapshots/null FK | audit/reconciliation workflow |
| Data-folder overwrite by updater | future path abstraction documented | Electron/user-data cutover |
| Schema migration failure | checksums/transactions plan | production backup/rollback runner |
