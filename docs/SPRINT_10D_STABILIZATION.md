# Sprint 10D — Stabilization, Reliability & Performance

## Architecture review status

Recommendation: **NO-GO for Sprint 11 until manual UAT and a real Windows crash/power-loss drill are completed.**

Automated stabilization and regression tests pass. The remaining blockers are operational verification, not known failing automated behavior. No production JSON was used for load, corruption, backup, restore, concurrency, or long-run tests.

## 1. Stabilization architecture

The runtime remains Node.js, Express, vanilla JavaScript, and JSON repositories. No business module was rewritten and optimistic locking remains enabled.

- `SafeJsonFile` owns atomic file replacement, file flush, latest-good `.bak`, corrupt evidence retention, and fail-closed startup.
- `RecoveryService` applies only deterministic recovery. Ambiguous deposit locks are reported for review.
- `IntegrityCheckService` is read-only and reports `PASS`, `WARNING`, or `ERROR`.
- `HealthService` exposes a sanitized OWNER-only view at `GET /api/health`.
- Backup format v2 contains all three runtime JSON files plus checksum and verification metadata.
- Frontend polling has one in-flight state request, one in-flight alert request, one session timer, and modal-aware reservation pause.
- Reservation decision operations have an in-process per-reservation lock in addition to version checking.

## 2. Baseline and performance

All measurements used disposable temp directories.

### Baseline findings

| Item | Before stabilization |
|---|---:|
| JSON writes | Direct whole-file overwrite |
| Corrupt primary behavior | Main store could seed over failure; reservation repositories returned empty arrays |
| Backup verification | JSON parse only; no checksum |
| Report, 10,000 bills | 5,471.64 ms |
| Reservation alert polling | Could issue duplicate pending-alert requests in one cycle |
| Session timer | Cleared and recreated after every state refresh |

### After stabilization, large isolated fixture

Fixture: 10,000 bills, 5,000 members, 20,000 audit events, 3,000 reservations, 1,000 deposits, and 1,000 products.

| Measurement | Result |
|---|---:|
| Server startup | 1,210–3,024 ms under concurrent test load |
| RSS memory | 177–212 MB |
| Bill history page | 25.93–37.36 ms |
| Member search | 15.42–29.98 ms |
| Reservation list | 28.73–60.64 ms |
| Large report | 27.84–54.33 ms |
| Dashboard `/api/state` | 94.88–121.14 ms |

The report improvement comes from caching Bangkok date parts and avoiding repeated `Intl.DateTimeFormat` calls per bill. CPU idle was not sampled with a stable external profiler and remains a production-observation item.

Current local JSON sizes (read-only measurement):

| File | Bytes |
|---|---:|
| `store.json` | 597,997 |
| `reservations.json` | 18,342 |
| `reservation-deposits.json` | 8,446 |

## 3. Polling inventory

| Endpoint/work | Interval | Page/condition | Pause/stop | Maximum requests/minute |
|---|---:|---|---|---:|
| Local table clock | 1 s | all authenticated pages | logout/page unload | 0 API |
| `/api/state` table refresh | 15 s | at least one playing table | no playing table; in-flight lock coalesces overlap | 4 |
| `/api/session/status` | 30 s | authenticated session | logout clears the single timer | 2 |
| `/api/reservation-alerts/pending` | 30 s | OWNER/MANAGER/CASHIER | Decision Modal pauses reservation polling | 2 |
| Reservation page `/api/state` | 30 s | reservation page and form not dirty | dirty form or Decision Modal | 2 |

On the reservation page, the 30-second cycle calls `refresh()` and lets its alert hook run once; it no longer calls the alert endpoint both before and after refresh. State and alert requests have request locks, so a new cycle cannot overtake the previous request.

## 4. Memory and timer audit

- Session timer initialization is idempotent and logout clears it.
- Recurring timers are created at application startup, not page changes.
- State and alert requests are coalesced while in flight.
- Decision Modal installs one close handler and restores the default handler on close.
- Alert audio creates short-lived Web Audio nodes; audio failure remains non-fatal.
- Search debounce timers are scoped to current form elements.
- Accelerated harness simulated 8 hours, 5,760 polling opportunities, repeated page/timer initialization, and 480 modal open/close cycles with four unique recurring timers and maximum one concurrent state request.

## 5. JSON write safety and corruption recovery

Every active runtime JSON writer now uses:

1. unique temporary file in the target directory;
2. full JSON write;
3. file `fsync`;
4. latest-good `.bak`;
5. atomic rename;
6. best-effort directory flush.

Writes to the same file are guarded and a concurrent re-entry fails with `JSON_WRITE_BUSY`. On startup, primary JSON is parsed and minimally shape-validated. A corrupt primary is copied to a timestamped `.corrupt-*` file and recovered from a valid `.bak`. If both copies are invalid, startup fails with `JSON_RECOVERY_FAILED`; it does not create an empty replacement.

Automated cases: normal JSON, missing file initialization, empty existing file, truncated JSON, syntax error, valid backup, and invalid backup.

## 6. Crash and stale-lock recovery

Persisted active table/session timestamps remain the source of truth after restart; billing start time is not regenerated. Existing idempotency/status checks prevent a paid bill, confirmed payment, settled deposit, or void action from being applied twice.

Startup recovery policy for `LOCKED` deposits:

- related paid bill: settle idempotently;
- no bill or checkout evidence and lock older than 30 minutes: return to `AVAILABLE`;
- any ambiguous evidence: retain lock and report `LOCKED_DEPOSIT_REVIEW`.

Every deterministic recovery action emits `RECOVERY_ACTION`. A real kill-during-write/power-loss drill on the target Windows filesystem remains required before production go-live.

## 7. Integrity and financial reconciliation

`GET /api/integrity` is OWNER-only and read-only. It checks:

- missing bill member/deposit references;
- invalid settled/available deposit linkage;
- missing reservation table;
- duplicate active session per table;
- duplicate receipt, bill, member, and deposit receipt numbers;
- negative product stock;
- duplicate revenue idempotency keys;
- forfeited deposit recognition marker;
- paid bill equation: gross = deposit applied + remaining;
- deposit totals: received = available + locked + settled + refunded + voided + forfeited.

The checker does not auto-fix financial data.

## 8. Backup verification and restore dry run

Backup v2 metadata includes `backupId`, `createdAt`, `fileCount`, SHA-256 checksum, byte size, application version, schema version, verification time, and verification status. A backup is returned as successful only after checksum, required-file, JSON, and basic shape verification.

`POST /api/backups/:file/dry-run` returns `RESTORABLE`, `WARNING`, or `INVALID` without writing production files. Actual restore:

1. verifies the selected backup;
2. creates a verified pre-restore backup;
3. atomically replaces each runtime JSON file;
4. rolls all three files back to the in-memory pre-restore snapshot if any replacement fails;
5. reruns startup recovery.

Legacy single-store backups remain readable and preserve current reservation/deposit files.

## 9. Health and logging

OWNER-only `GET /api/health` returns:

- `HEALTHY`, `WARNING`, or `CRITICAL`;
- JSON file parse status and sizes;
- repository readiness;
- active server timers and JSON writes;
- latest backup verification;
- integrity summary;
- relay status;
- pending recovery items;
- process memory and uptime.

It does not expose password hashes or session tokens. Operational request logs contain timestamp, level, event, request ID, user ID, route, HTTP status, and duration. JSON parse failures return a structured Thai-facing error. Unhandled promise rejections are recorded without logging request bodies or credentials.

## 10. Relay reliability

Relay commands record desired and actual states separately, retry at most three times, and retain a pending marker while offline. Tests cover 100 ON and 100 OFF commands, offline retries, bounded attempts, and state preservation. Physical ESP32 timeout/reconnect verification is pending hardware UAT.

## 11. Automated test results

- Sprint 10D: 15/15 passed.
- Full regression Sprint 0–10C and emergency recovery: 59/59 passed.
- JSON safety: 4/4 passed.
- Integrity/recovery/reconciliation: 3/3 passed.
- Reservation decision concurrency and 300-number sequence: 2/2 passed.
- Relay reliability: 2/2 passed.
- Health/backup/dry-run integration: passed.
- Large-data performance: passed all response targets.
- 60-second dirty reservation form regression: passed.

The Sprint 9A.1 fixture was updated to use the current Sprint 9B table-time loyalty inputs; no Loyalty implementation was changed.

## 12. Manual UAT status

Manual browser/hardware UAT was **not claimed as passed** in this architecture run. The automated suite covers the underlying flows, but the following must be signed off on the shop workstation:

- Walk-in, reservation Open Now/Defer/Check-in/No-show;
- deposit settlement/refund and combined/POS billing;
- member earn/redeem, void, multi-tab/session expiry;
- restart with active table and awaiting payment;
- verified backup and restore dry-run;
- ESP32 offline/reconnect;
- one extended live-use session.

No stress test wrote to shop production data.

## 13. Files added

- `infrastructure/safe-json-file.js`
- `services/health-service.js`
- `services/integrity-check-service.js`
- `services/recovery-service.js`
- `services/relay-service.js`
- `tests/sprint10d-concurrency.test.js`
- `tests/sprint10d-health-backup-route.test.js`
- `tests/sprint10d-integrity-recovery.test.js`
- `tests/sprint10d-json-safety.test.js`
- `tests/sprint10d-large-data-performance.test.js`
- `tests/sprint10d-long-run-harness.test.js`
- `tests/sprint10d-relay-reliability.test.js`

## 14. Files modified

- `index.js`
- `package.json`
- `public/js/app.js`
- `repositories/reservation-repository.js`
- `repositories/reservation-deposit-repository.js`
- `services/reservation-service.js`
- `tests/sprint9a1-member-ui-integration.test.js` (fixture compatibility only)

## 15. Known limitations

- Atomicity is per JSON file. A verified multi-file restore has rollback, but normal business operations spanning `store.json` and reservation/deposit files are not a database transaction.
- The write guard protects one Node process. Running two server processes against the same data directory is unsupported.
- Receipt allocation is safe inside the single process; it is not a cross-process distributed sequence.
- In-memory locks disappear on process exit; persisted statuses, version checks, recovery, and integrity checks are the restart safety net.
- Report endpoints still perform in-memory scans; benchmarks pass at the required fixture size.
- Printer behavior and physical ESP32 behavior require hardware UAT.
- CPU idle and genuine power-loss behavior have not been measured on the target shop machine.

## 16. Recommended production hardware

- Windows 11 64-bit;
- modern 4-core CPU or better;
- 8 GB RAM minimum, 16 GB recommended;
- SSD with at least 20 GB free;
- UPS for the server/ESP32 network equipment;
- wired LAN for the server and relay controller;
- separate daily copy of verified backups to another physical device.

## 17. Go / No-Go

Automated architecture gate: **GO**.

Production/Sprint 11 gate: **NO-GO pending manual UAT, target-machine CPU/idle measurement, physical relay test, and forced power-loss recovery drill**. If those checks pass without integrity `ERROR`, Sprint 11 may proceed without changing the JSON runtime.
