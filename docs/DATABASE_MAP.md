# Database and Data Map — Sprint -1

## Current state: JSON, not SQLite

There is no SQLite database in the repository. The live data file is `data/store.json`, loaded by `index.js`; backups are JSON files in `data/backups/`. The data file contains top-level collections `settings`, `tables`, `members`, `products`, `bills`, and `payments`.

| Collection | Identifier / fields observed | Logical relationships |
|---|---|---|
| settings | singleton fields: `shopName`, rates, `tableCount`, `promptPayId` | Used for billing and UI |
| tables | numeric `id`, `code`, `relay`, `memberId`, `items` | `memberId` logically references members; `items.productId` logically references products |
| members | UUID-derived string `id`, `code` | Referenced by table and bill snapshots |
| products | string `id`, `name`, `price`, `category`, `active` | Copied into table item snapshots |
| bills | UUID-derived string `id`, display `number`, member/table snapshots, monetary fields, item snapshots | `memberId`, `tableId`; a payment points to the bill |
| payments | UUID-derived string `id`, `billId`, `amount`, `status`, `reference` | `billId` logically references bills |

The bill stores denormalized table/member/item values, which is useful for historical receipts but has no database-enforced consistency.

## Constraints, indexes, transactions, backup

- Primary keys, foreign keys, indexes, `NOT NULL`, unique constraints, and SQL foreign-key enforcement: **not applicable / absent** in the current JSON store.
- Validation is endpoint-specific and incomplete; `save()` rewrites the complete JSON file synchronously.
- There is no transaction or write lock. Two requests/processes can cause lost updates or a partially interrupted file write.
- `backupNow()` copies `store.json`; automatic backup is evaluated after saves and retains the latest 30 files. Restore parses JSON, makes a backup, replaces the in-memory store, then saves. Structural validation of a restored backup is absent.

## Data-loss risks

1. `data/` resides with source/application files and could be overwritten by a future installer or updater.
2. A full-file write has no atomic replace, journaling, checksum, or crash recovery.
3. Delete-bill and delete-backup endpoints perform permanent deletion without an audit trail or authorization.
4. JSON backup restore accepts any parseable JSON, including an incompatible or incomplete shape.

## Proposed SQLite migration (not implemented)

Keep the current JSON importer as a one-time migration path. Use SQLite in User Data with `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, a `schema_migrations(version, name, applied_at, checksum)` table, and numbered, immutable scripts such as `001_initial_schema.sql`.

Migration runner requirements:

1. Close/serialize application writes and create a verified User Data backup.
2. Open one database transaction for each migration; record history only after success.
3. Use idempotent guards where SQLite permits them; never silently skip a changed historical migration.
4. On failure, roll back the transaction, keep the pre-migration backup, record diagnostics, and block normal start until recovery is chosen.
5. Do not drop tables in automatic migrations; use expand/backfill/dual-read/contract phases.

Proposed entities include shop settings, tables, rate plans, table sessions and pauses, members, member points ledger, products, categories, inventory movements, orders/order lines, bills/bill lines/payments/discounts, reservations, audit events, licenses, and migration history. Exact schema is deferred to the database sprint.
