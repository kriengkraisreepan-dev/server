# Permission Matrix

| Feature | OWNER | MANAGER | CASHIER | STAFF |
|---|---|---|---|---|
| Staff management / security settings | Yes | No | No | No |
| Active sessions | Manage | View only | No | No |
| Change own password | Yes | Yes | Yes | Yes |
| Void bills (password re-entered every time) | Yes | Yes | No | No |
| Close out a "รอตรวจสอบ" (pending_review) bill — same password-gated Void | Yes | Yes | No | No |
| Cancel a table or seat tab from its card (becomes a "รอตรวจสอบ" bill, nothing restocked) | Yes | Yes | Yes | Yes |
| View products | Yes | Yes | Yes | Active only |
| View stock movements | Yes | Yes | Yes | Active product only |
| Create/edit/enable/disable product/category (password step-up, 10 idle minutes) | Yes | Yes | No | No |
| Receive or adjust stock (same step-up) | Yes | Yes | No | No |
| View all POS orders | Yes | Yes | Own only | Own only |
| Create/edit/cancel own POS draft | Yes | Yes | Yes | Yes |
| Confirm POS order | Yes | Yes | Yes | No |
| Create table or walk-in bill / receive payment | Yes | Yes | Yes | No |
| Cancel confirmed POS order / restore stock | Yes | Yes | No | No |
| View/search members | Yes | Yes | Yes | ACTIVE only |
| Create/edit/enable/disable members | Yes | Yes | No | No |
| View member point history | Yes | Yes | Yes | ACTIVE members only |
| Preview/use member reward points | Yes | Yes | Yes | No |
| View coupons and their redemption history | Yes | Yes | No | No |
| Create/edit/pause coupons, print voucher batches | Yes | Yes | No | No |
| Check a coupon code against a member (`/api/coupons/validate`) | Yes | Yes | Yes | Yes |

## Password step-up on a shared shop computer

The shop computer is shared, so a logged-in OWNER/MANAGER session can be left open and used by whoever sits down. Two things therefore need the account password typed again even inside an open session, and both are enforced on the server, not only in the UI:

- **Product screen** — every product/category/stock write (`requireElevation("products")` in `index.js`) needs a step-up obtained with `POST /api/auth/elevate {scope:"products", password}`. It lasts 10 minutes and each write restarts the clock; leaving the screen drops it (`DELETE /api/auth/elevate?scope=products`), as does logout. Reads are not gated — the POS lists products all day.
- **Void** — `DELETE /api/bills/:id` requires `password` in the body on every call.

Wrong passwords at either prompt count toward the same lockout as failed logins (`AuthService#verifyCurrentPassword`), so neither can be used to guess the password from inside an open session.
