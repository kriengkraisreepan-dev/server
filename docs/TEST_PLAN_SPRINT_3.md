# Sprint 3 Test Plan

| Scenario | Expected result |
|---|---|
| Open → checkout | Session becomes `AWAITING_PAYMENT`; bill draft and pending payment are created. |
| Cash / transfer confirmation | Bill and payment become paid; session closes and table is released. |
| Duplicate payment | Rejected while a pending or paid payment exists. |
| Insufficient payment | Rejected before payment is saved. |
| Cancel pending payment | Payment becomes cancelled; bill remains awaiting payment. |
| Confirm cancelled/paid payment | Rejected. |
| Receipt allocation | Same-day receipt numbers increment and do not repeat. |
| Audit | Each material workflow event has an append-only audit row. |
| Backup / restore | JSON copy preserves bills, payments, and audit logs. |
| Legacy pending QR record | Existing pending bill/payment can still be confirmed. |

Automated coverage is in `tests/sprint3-billing-payment.test.js`. Runtime API smoke checks should use a copy of `data/store.json`, not customer production data.
