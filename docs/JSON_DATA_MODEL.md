# Sprint 0 — JSON Data Analysis

Source examined: `data/store.json` as of 2026-07-26. JSON remains the active production store.

| Entity | JSON shape / key | Main fields and types | Nullable / nested / redundancy |
|---|---|---|---|
| Settings | singleton object | string shop name; numeric rates/table count; string PromptPay id | promptPay id may be empty; values are global key/value data |
| Table | `tables[]`, numeric `id` | code/name strings, relay integer, status string, memberId string, startTime ISO string, relayState string | memberId/startTime nullable; `items[]` nested; table items duplicate product snapshot data |
| Member | `members[]`, string `id`; display `code` | name/phone/note strings, integer points, createdAt ISO string | phone/note may be empty; no explicit active/deleted state |
| Product | `products[]`, string `id` | name string, price number, category string, active boolean | category may be empty; no cost, stock, category ID |
| Bill | `bills[]`, string `id`; display `number` | table/member IDs and names, timestamps, duration, numeric totals, payment method/status | table/member IDs may be null; `items[]` intentionally duplicates name/price/total snapshots for receipts |
| Payment | `payments[]`, string `id` | billId, amount number, status, reference, createdAt, optional paidAt | paidAt nullable; current records arise from QR flow |

## Logical relationships

```text
members 1 ──< tables.memberId (active association, nullable)
members 1 ──< bills.memberId (historical link, nullable)
snooker table 1 ──< bills.tableId (historical link, nullable)
products 1 ──< table.items[].productId (nullable snapshot reference)
products 1 ──< bills.items[].productId (nullable snapshot reference)
bills 1 ──< payments.billId (required)
```

Primary keys today are application-managed IDs; no database enforces them. The importer validates duplicate IDs, display codes, required arrays, numeric constraints, active-table start times, and broken payment references. Historical broken member/table/product references are warnings: imports preserve snapshot text while nulling only the relational foreign key.

## Data quality observations

- Receipt snapshots (`tableName`, `memberName`, item names/prices/totals) are deliberate denormalization and must be retained in SQLite.
- Product categories are repeated strings, so import deduplicates them into category rows.
- Current tables carry session state and nested items. SQLite separates an open `table_session` and `session_items`.
- Current bills have no discount field; target schema reserves `discount_amount` as zero for imported rows.
- A legacy JSON backup has no schema/version marker, so import validation is mandatory.
# Sprint 3 additive runtime fields

The JSON production store now may contain `auditLogs` (array). New bills add `receiptNumber`, `*Satang` amounts, pricing snapshot, `awaiting_payment`/`paid`/`void` status, and void metadata. New payments add `method`, `amountSatang`, `pending`/`paid`/`cancelled` status, and timestamps. Older bill/payment shapes remain readable.
