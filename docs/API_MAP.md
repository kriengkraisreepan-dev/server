# API Map — Sprint -1

All endpoints are implemented in `index.js`. They currently use the JSON store, not a database. There is no authentication or edition authorization on any route.

| Method | Path | Purpose / request | Response and data | Validation / risk |
|---|---|---|---|---|
| GET | `/api/state` | No request body; returns application state | settings, enriched tables, members, products, bills, payments | Exposes all business data to any caller on the reachable server |
| PUT | `/api/settings` | Arbitrary JSON merged into settings | settings object | No allow-list/type validation; no authorization |
| GET | `/api/backups` | List backup metadata | JSON list | No authorization |
| POST | `/api/backups` | Create backup | backup filename/time | Writes data; no authorization |
| GET | `/api/backups/:file/download` | Download validated backup filename | JSON file | basename/regex guard exists; no authorization |
| POST | `/api/backups/:file/restore` | Restore validated backup filename | status message | JSON parse only; destructive; no authorization or schema validation |
| DELETE | `/api/backups/:file` | Delete backup | status message | permanent destructive action without authorization |
| POST | `/api/members` | `name`, optional phone/points/note | created member | Name check only; no update/delete/search API |
| POST | `/api/products` | `name`, `price`, optional category | created product | basic name/non-negative check; no update/deactivate/inventory API |
| POST | `/api/tables/:id/start` | optional `memberId` | enriched table, possible relay warning | checks table/member existence; controls relay indirectly |
| POST | `/api/tables/:id/items` | `productId`, optional quantity | enriched table | product/table checks; quantity lacks strict positive integer validation |
| POST | `/api/tables/:id/checkout` | optional `paymentMethod` | bill; QR payment when selected | payment method not allow-listed; creates a bill |
| POST | `/api/payments/:id/confirm` | No body | bill/payment | confirms a pending QR payment without external proof |
| DELETE | `/api/bills/:id` | No body | status message | permanently deletes bill and linked payments without authorization/audit |
| POST | `/api/relay/:tableId` | `state` (`on` or otherwise `off`) | enriched table/message | can trigger a configured ESP32 relay without authorization |
| GET | `/api/reports/summary` | optional `date` | paid-bill aggregates and bills | date syntax is not validated |
| GET | `/api/reports/analytics` | optional `type`, `period` | revenue/time/product aggregates | period syntax is not validated |

`express.static(public)` additionally exposes the SPA assets. No CORS middleware was found; Express therefore does not add permissive CORS headers by default. Local-network exposure must nevertheless be treated as unauthenticated access.
# Sprint 3 additions and behavior

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/tables/:id/checkout` | Creates bill draft and pending cash/transfer payment; does not release table yet. |
| POST | `/api/payments/:id/confirm` | Confirms a pending payment, closes the session, releases the table. |
| POST | `/api/payments/:id/cancel` | Cancels a pending payment; bill remains awaiting payment. |
| DELETE | `/api/bills/:id` | Compatibility path retained; now voids and audits rather than physically deleting. |
| GET | `/api/bills` | Searches bills by receipt, table, date range, status; returns newest-first paginated results. |
| GET | `/api/bills/:id` | Returns bill, linked payments, and related audit events. |

## Sprint 4 Void requirement

`DELETE /api/bills/:id` now requires a non-empty JSON `reason`. It may include `actorId` (or use the `x-actor-id` header); otherwise the audit event is attributed to `SYSTEM`.

## Sprint 5 authentication

| Method | Path | Access |
|---|---|---|
| POST | `/api/auth/login` | Username/password; sets session cookie. |
| POST | `/api/auth/logout` | Authenticated session; removes session. |
| GET | `/api/auth/me` | Authenticated session; returns safe user profile. |

All non-auth API routes now require a valid session. Authorization middleware returns `403` for a logged-in user without the required permission.

## Sprint 7 session and security APIs

`GET /api/session/status`, `PATCH /api/session/refresh`, `GET /api/sessions`, `DELETE /api/sessions/:id`, `DELETE /api/sessions`, `GET /api/settings/session`, and `PATCH /api/settings/session` are authenticated. Session list is OWNER/MANAGER; revoke and settings are OWNER-only.

## Sprint 8A product and inventory APIs

All endpoints below require authentication. `product.view` is granted to every role; `product.manage` and `inventory.manage` are OWNER/MANAGER only.

| Method | Path | Request / behavior | Failure cases |
|---|---|---|---|
| GET | `/api/products` | Filters: `search`, `category`, `status`, `lowStock`, `page`, `pageSize`; response includes `items` and `pagination` | 403 without view permission |
| GET | `/api/products/:id` | Returns one visible product | 404 unknown/hidden product |
| POST | `/api/products` | Creates normalized product; accepts initial stock | 400 invalid fields, 409 duplicate SKU |
| PATCH | `/api/products/:id` | Updates metadata only | 400 validation, 404 unknown category/product |
| PATCH | `/api/products/:id/status` | `ACTIVE` or `DISABLED` | 400 invalid status |
| POST | `/api/products/:id/stock/receive` | Positive `quantity`, optional reason/reference | 400 untracked/invalid quantity |
| POST | `/api/products/:id/stock/adjust` | Non-zero `quantityChange`, required reason | 400 invalid/negative resulting stock |
| GET | `/api/products/:id/stock-movements` | Paginated immutable history | 404 unknown product |
| GET | `/api/product-categories` | Lists visible categories | 403 without view permission |
| POST/PATCH | `/api/product-categories` | Create/update name/sort order | 400 invalid, 409 duplicate name |
| PATCH | `/api/product-categories/:id/status` | `ACTIVE` or `DISABLED` | 400/404 |
