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

## Void modes (added later, alongside mid-session split bills)

Voiding a bill that carried products says nothing on its own about where the goods went, so the
request also carries a `voidMode` and the bill records it. Each mode is a different combination of
stock and revenue:

| `voidMode` | Stock | Charged | Situation |
| --- | --- | --- | --- |
| `CANCEL_RESTORE_STOCK` | returned to the shelf | no | the goods were never handed over |
| `RETURN_TO_TAB` | stays deducted | on the final bill | goods delivered, billed the wrong way — the orders go back to `UNBILLED` |
| `CANCEL_KEEP_STOCK` | stays deducted | no | goods consumed but written off (comp, waste) |

`CANCEL_RESTORE_STOCK` is the default and the behaviour every earlier client gets, since `voidMode`
is optional. `RETURN_TO_TAB` is accepted only while the *session the bill was created from* is still
open — matching the session and not merely the table, because a table that has closed and reopened
for the next customer would otherwise absorb the previous customer's drinks. The server rejects it
with `409 TAB_NO_LONGER_OPEN` before mutating anything; the dialog greys the option out with the
reason rather than hiding it.

`BILL_VOIDED` carries `voidMode` so reporting can separate an honest mistake from a comp.

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
