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

## The manager passcode — a shared secret, separate from any login

The shop computer is shared, so a logged-in OWNER/MANAGER session can be left open and used by whoever sits down. If either gate below checked that person's own login password, knowing the login would be enough — so both check a single shop-wide **manager passcode** instead (`ManagerPasscodeService`, `store.managerPasscode`), set from Settings (OWNER only) and never returned to any client. Both checks are enforced on the server, not only in the UI:

- **Product screen** — every product/category/stock write (`requireElevation("products")` in `index.js`) needs a step-up obtained with `POST /api/auth/elevate {scope:"products", password}` (`password` here is the manager passcode, not the caller's own). It lasts 10 minutes and each write restarts the clock; leaving the screen drops it (`DELETE /api/auth/elevate?scope=products`), as does logout. Reads are not gated — the POS lists products all day.
- **Void** — `DELETE /api/bills/:id` requires the manager passcode as `password` in the body on every call.

A shop that has not set a passcode yet elevates and voids for free (`ManagerPasscodeService#verify` is a no-op until `store.managerPasscode.hash` exists) — this is what makes the passcode optional-but-recommended rather than a breaking change for shops that upgrade before configuring it. Wrong passcodes count toward the same lockout policy as a failed login (`settings.security.maxLoginAttempts`/`lockDurationMinutes`). Forgetting it entirely needs the shop machine itself: `LUCKY_EMERGENCY_RESET_MANAGER_PASSCODE=1` at startup resets it to a known temporary value and flags `mustChange`, mirroring the existing `LUCKY_EMERGENCY_RESET` admin-password reset.
