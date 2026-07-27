# Sprint 9A — Member Foundation & Loyalty Core

`members[]` is normalized additively with identity/contact, active status, tier, points, spend/visit counters, timestamps and actors. `memberPointTransactions[]` is an immutable additive ledger.

Paid bills are the only loyalty source of truth: every complete 20 THB earns one point. A paid bill is marked after earning so it cannot earn twice. Voiding that bill creates a negative `VOID` transaction and reverses the earned points once. No points are redeemed or used as discounts in Sprint 9A.

Member APIs: list/search, read, create, update, status and point history under `/api/members`. Existing JSON members are preserved and normalized lazily.
