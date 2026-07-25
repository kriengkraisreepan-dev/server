# Sprint 0 — Proposed SQLite Schema

`database/migrations/001_initial_schema.sql` is a prepared schema only. It is not invoked by `index.js`, no production database was created, and JSON remains live.

```mermaid
erDiagram
  MEMBERS ||--o{ TABLE_SESSIONS : plays
  SNOOKER_TABLES ||--o{ TABLE_SESSIONS : hosts
  RATE_PLANS ||--o{ TABLE_SESSIONS : prices
  TABLE_SESSIONS ||--o{ SESSION_ITEMS : contains
  PRODUCTS ||--o{ SESSION_ITEMS : references
  PRODUCT_CATEGORIES ||--o{ PRODUCTS : groups
  MEMBERS ||--o{ SALES : customer
  SNOOKER_TABLES ||--o{ SALES : billed_at
  SALES ||--o{ SALE_ITEMS : contains
  PRODUCTS ||--o{ SALE_ITEMS : snapshot_source
  SALES ||--o{ PAYMENTS : settles
  MEMBERS ||--o{ POINT_TRANSACTIONS : owns
  SALES ||--o{ POINT_TRANSACTIONS : relates
  PRODUCTS ||--o{ INVENTORY_MOVEMENTS : moves
  SNOOKER_TABLES ||--o{ RESERVATIONS : reserves
```

Key design choices:

- Every business entity uses a stable primary key; imported legacy IDs are preserved where possible.
- Foreign keys are declared and future database opens enforce `PRAGMA foreign_keys=ON`.
- Money uses `NUMERIC`; a later billing sprint must choose integer satang or fixed decimal discipline consistently.
- Sale/item snapshots retain receipt accuracy after product/member/table edits.
- `schema_migrations` provides version/checksum history. Indexes cover sessions, sales, payments, inventory, reservations.
- Reservations, inventory, points, rate plans and audit events are schema preparation only; no UI/API feature is enabled.
