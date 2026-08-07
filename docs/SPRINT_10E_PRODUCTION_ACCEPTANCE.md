# Sprint 10E — Production Acceptance Review

## Acceptance summary

Sprint 10E introduced no business features and made no changes to Billing, Reservation workflow, Deposit workflow, Loyalty, POS, pricing, permissions, database format, or architecture.

Production acceptance documents and a 50-scenario manual UAT matrix are ready. Automated endpoint verification passed in an isolated temporary data directory. Manual shop-floor acceptance has not yet been executed or signed; therefore the current production decision is **NO GO**.

## Deliverables

- `docs/PRODUCTION_ACCEPTANCE_CHECKLIST.md`
- `docs/UAT_DAY1.md`
- `docs/UAT_DAY2.md`
- `docs/UAT_DAY3.md`
- `docs/UAT_DAY4.md`
- `docs/UAT_DAY5.md`
- `docs/PRODUCTION_GO_LIVE.md`
- `docs/PRODUCTION_ACCEPTANCE_REPORT.md`
- `docs/MANUAL_UAT_MATRIX.md`
- this Production Acceptance Review

## Executed verification

The verification server used a disposable temp directory and did not write shop production JSON.

| Verification | Result |
|---|---|
| Unauthenticated `GET /api/health` | 401 JSON |
| Authenticated OWNER `GET /api/health` | 200 JSON; valid status; server/memory/files present; no secrets |
| Authenticated OWNER `GET /api/integrity` | 200 JSON; PASS/WARNING accepted; no unexplained ERROR |
| Verified backup creation | 201; `VERIFIED`; checksum and three files |
| Restore from verified backup | 200; pre-restore backup created |
| Startup log | Structured `SERVER_STARTED` observed |
| Backup log | Structured `BACKUP_VERIFIED` observed |
| Restore log | Structured `RESTORE_COMPLETED` observed |
| Relay log | Success/failure/not-configured event paths tested |
| Crash log | `UNHANDLED_REJECTION` and `UNCAUGHT_EXCEPTION` handlers verified by test/source inspection |
| Shutdown log | SIGINT/SIGTERM handlers emit `SERVER_SHUTDOWN` and `SERVER_STOPPED`; Ctrl+C confirmation remains manual Windows UAT |

Sprint 10E endpoint/logging verification: passed.

## Production logging defect and correction

The initial acceptance inspection found that startup output was not structured and shutdown, uncaught-exception, backup, restore, and relay lifecycle events were absent. This was a production observability defect, so only logging was corrected:

- structured server startup;
- graceful SIGINT/SIGTERM shutdown and stop events;
- uncaught exception and unhandled rejection events;
- verified backup and restore/rollback events;
- bounded relay success/failure/not-configured events.

No request body, password, session token, password hash, or payment-sensitive content is logged.

## Manual acceptance plan

The five UAT days separate risk so failed tests can be investigated without mixing evidence:

1. startup, accounts, dashboard, table lifecycle;
2. walk-in, POS, billing, duplicate-click protection, printing;
3. reservations, decisions, check-in/no-show, deposits, concurrency;
4. members, reports, backup, restore, health and integrity;
5. crash recovery, UPS, ESP32, network, long session and shutdown.

Every test records expected result, actual result, pass/fail, operator, date, and remark. The matrix contains 50 real-world scenarios including full tables, simultaneous arrivals, duplicate checkout, power loss, printer/ESP32 offline, refund, void, and backup/restore.

## Production hardware recommendation

- Windows 11 64-bit workstation, modern 4-core CPU, 8 GB RAM minimum and 16 GB recommended;
- SSD with at least 20 GB free;
- line-interactive UPS with AVR, 800–1200 VA, covering server and network;
- wired gigabit SMB router/switch with POS/ESP32 isolated from guest Wi-Fi;
- 80 mm thermal receipt printer using stable Windows Ethernet or USB driver;
- ESP32 in a protected enclosure, regulated supply, IP reservation, isolated correctly rated relay module, and mains wiring by a qualified technician.

Windows must use Bangkok time, automatic clock synchronization, no sleep during shop hours, scheduled updates outside shop hours, private-network firewall rules, and exactly one server process for the data directory.

## Remaining risks

| Severity | Risk | Impact | Mitigation / acceptance evidence |
|---|---|---|---|
| High | Real power loss has not been tested on shop hardware | Recovery behavior may differ by filesystem/UPS | Execute D5-02/D5-03/D5-07 and verify JSON, health and integrity |
| High | Physical ESP32/relay has not passed UAT | Lights may not match business state | 100 ON/OFF per deployment, offline/reconnect test, UPS and safe wiring |
| High | Receipt printer has not passed Thai/offline testing | Customer receipt unavailable or unreadable | Run D2-07–D2-09 with actual paper/driver |
| High | Manual UAT and Owner sign-off pending | Production behavior is not accepted | Complete all Day 1–5 documents and acceptance report |
| Medium | Atomicity is per JSON file, not a multi-file transaction | Rare cross-file recovery review after abrupt loss | UPS, verified daily backups, recovery/integrity review after abnormal stop |
| Medium | A second Node process sharing the data directory is unsupported | Cross-process write collision | Single Windows service/process and startup runbook |
| Medium | In-memory locks disappear on crash | Ambiguous deposit may remain locked | Startup RecoveryService flags ambiguity; Owner reviews health |
| Medium | CPU idle not measured on target hardware | Undetected resource constraint | Record Task Manager CPU/RAM during Day 5 long session |
| Medium | Network/browser multi-tab acceptance pending | Operators may see transient conflict | Execute concurrency scenarios 09, 12, 32, 35 and 40 |
| Low | Report endpoints use in-memory scans | Response may grow with years of data | Monitor duration logs; current 10,000-bill benchmark passes |
| Low | Backup retention depends on local disk availability | Backup creation may fail if disk full | Monitor disk space and copy verified backup off-machine daily |
| Low | Windows forced termination may bypass graceful signal | Stop log may be absent after Task Manager kill | Use documented Ctrl+C/service stop and treat absent stop log as abnormal shutdown |

## Production checklist gate

The following must all be checked before GO:

- Server/Windows/Node baseline recorded;
- JSON backup VERIFIED and copied off-machine;
- UPS runtime and shutdown tested;
- ESP32 actual/desired states tested on every table;
- Printer online/offline/reprint tested;
- Automatic backup and restore dry-run passed;
- Actual restore passed using disposable acceptance data;
- Owner, Manager, and Cashier accounts tested;
- daily backup policy assigned to a named person;
- Health not CRITICAL;
- Integrity contains no unexplained ERROR;
- all UAT Day 1–5 tests passed;
- no critical issue remains;
- Owner signed the acceptance report.

## Exit criteria status

| Criterion | Status |
|---|---|
| Manual UAT passed | PENDING |
| Power-loss recovery passed | PENDING |
| ESP32 real hardware passed | PENDING |
| Printer passed | PENDING |
| Backup verified | PASS in isolated verification; production evidence pending |
| Restore verified | PASS in isolated verification; production evidence pending |
| Owner signs off | PENDING |
| No critical bugs | No known automated critical failure; manual confirmation pending |

## Production readiness decision

### **NO GO**

Reason: the software-side verification passes, but Sprint 10E exit criteria explicitly require real manual UAT, power-loss recovery, ESP32 hardware, printer, production backup/restore evidence, and Owner sign-off. These cannot be inferred from automated tests.

Change the decision to **GO** only after all pending rows above are marked PASS in `PRODUCTION_ACCEPTANCE_REPORT.md`, every critical UAT scenario passes, and the Owner signs the report.
