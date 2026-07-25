# Development Roadmap — proposed after Sprint -1

This sequence respects dependencies and does not start any of these sprints.

| Order | Sprint | Scope / dependency |
|---:|---|---|
| 0 | Foundation decision | Confirm product naming, supported Windows versions, data-retention and key-management policies |
| 1 | Data foundation | User Data layout, SQLite design/import plan, migrations, transactional backup/restore |
| 2 | Settings | Shop profile, table definitions, rate plans, rounding/minimum charge; validated settings API |
| 3 | Table management | sessions, pause/resume, lifecycle state machine, table events/audit |
| 4 | Billing | immutable bill/void workflow, discounts, payments, receipt correctness |
| 5 | Product management | categories, sell/cost prices, safe deactivate/edit, product history |
| 6 | Inventory | stock ledger, automatic stock deduction, adjustments and audit |
| 7 | POS | order lifecycle, bill lines, concurrent operation handling |
| 8 | Members | search, safe edit/deactivate, time accumulation, privacy rules |
| 9 | Points | points ledger, redemption rules, receipt balance |
| 10 | Reports | date-range reports, reproducible aggregates, export foundation |
| 11 | Backup and restore | verified backups, restore validation, retention, recovery drills |
| 12 | ESP32 | device setup, protected relay commands, reconciliation and failure handling |
| 13 | Offline License Runtime | signed file verification, backend feature guards, Standard/Pro menu gating |
| 14 | Windows Build | Electron hardening, User Data separation, installer and printing verification |
| 15 | Lucky License Manager | owner-only signer, customer/license records, export/renew/upgrade workflow |
| 16 | Standard/Pro Feature Access | module registry, entitlement tests, upgrade without data loss |
| 17 | Pro modules | reservations, KDS/bar, staff/mobile/QR ordering, coupons, advanced dashboard/export/remote management |
| 18 | Lucky Updater | signed packages, staging, migration, rollback, restart flow |

Every sprint should include migration/rollback plan, security review, tests, and compatibility notes. Do not begin the next item until the predecessor's acceptance criteria are agreed.
