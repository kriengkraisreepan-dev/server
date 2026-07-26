# Sprint 4: Bill History, Void Governance & User Accountability

## Bill history

The Bill History page lists newest bills first and provides receipt, table, date-range, and status filters. Statuses are `paid`, `void`, and `awaiting_payment`. Results are served by the JSON-backed search API and support `page` and `pageSize`.

Selecting **รายละเอียด** shows the receipt number, table, start/end/duration, pricing snapshot, pre-round and final totals, payment records with received time, and related audit events.

## Void policy

- A bill is never physically deleted.
- Void requires a non-empty reason.
- A voided bill cannot be voided again.
- The original receipt number, reason, time, and actor are retained on the bill.
- Pending payments are cancelled before voiding; creating or confirming a payment against a voided bill is rejected.
- The audit trail receives `BILL_VOIDED` and retains the supplied actor and receipt number.

## Accountability

Audit records now contain `actorId`. Until Login is introduced, events default to `SYSTEM`; a missing/blank supplied value resolves to `UNKNOWN`. The Void API accepts an optional `actorId` body property or `x-actor-id` request header for a future user layer.

## API

- `GET /api/bills?receipt=&table=&from=YYYY-MM-DD&to=YYYY-MM-DD&status=paid|void|awaiting_payment&page=1&pageSize=20`
- `GET /api/bills/:id` returns `{ bill, payments, auditEvents }`.
- Existing `DELETE /api/bills/:id` remains the Void compatibility route but now requires `{ reason }`; it never deletes persisted bill/payment/audit data.

## JSON and backup compatibility

All fields are additive: `voidReason`, `voidedAt`, `voidedBy`, `originalReceiptNumber`, and audit `actorId`. JSON backups copy the complete object and restore these fields unchanged. Legacy records without these fields remain readable.

## Sprint 5 recommendation

Add a narrowly scoped authentication and staff-role foundation, then replace the temporary `SYSTEM` actor with authenticated users. Do not start SQLite cutover or unrelated business modules in that sprint without a separate scope decision.
