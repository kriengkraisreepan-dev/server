# Sprint 9A.1 — Member UI & Integration Completion

Sprint 9A.1 completes the member-facing integration while retaining JSON as the production store.

## Delivered

- Server-backed member list, search, filters, create/edit, enable/disable, and point-history UI.
- Role-aware UI: OWNER/MANAGER can manage; CASHIER/STAFF are read-only. The server remains authoritative.
- Debounced active-member search when opening a table and when creating a walk-in POS draft.
- Walk-in draft orders snapshot `memberId`, `memberCode`, and `memberName`; this data is copied into the resulting bill.
- Bills keep member code/name snapshots. Paid bills record `pointsEarned` and `pointsBalance`; voiding reverses points once.
- Printed receipts show member information and loyalty points only when a bill has a member.
- Dashboard member counts and report metrics for member revenue, non-member revenue, top members, points, and new members.

## Loyalty policy

- Only a paid bill earns points: one point per complete 20 THB.
- Void reverses the earned points and reverses `totalSpent`; visit count is retained as a historical completed-visit count.
- Ledger events are immutable `EARN` and `VOID` transactions. Existing/legacy bills without member fields remain valid.

## Verification

- `node tests/sprint9a1-member-ui-integration.test.js`
- Sprint 3 payment, Sprint 8C.1 walk-in, and Sprint 9A member tests.

## Deferred

Point redemption, automatic tier upgrades, campaigns, coupons, and RFM analytics remain outside Sprint 9A.
