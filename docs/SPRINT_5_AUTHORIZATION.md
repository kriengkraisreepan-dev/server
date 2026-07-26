# Sprint 5: Authentication, Staff Roles & Permissions

## Authentication

Users are stored additively in `users[]` with `userId`, normalized username, `passwordHash`, display name, role, status, and timestamps. Passwords use Node.js `crypto.scrypt` with a random salt; plaintext passwords are never persisted. Login creates a server-side, eight-hour session represented by an HttpOnly, SameSite cookie. Logout invalidates that session.

On the first run only, an `admin` OWNER is created. The default password is `ChangeMe123!`, or `LUCKY_BOOTSTRAP_PASSWORD` when provided. Change the initial password before operational use.

## Authorization matrix

| Permission | OWNER | MANAGER | CASHIER | STAFF |
|---|---:|---:|---:|---:|
| Open table | Yes | Yes | Yes | Yes |
| Pause / resume | Yes | Yes | No | Yes |
| Checkout / receive payment | Yes | Yes | Yes | No |
| View bills | Yes | Yes | Yes | No |
| Void bill | Yes | Yes | No | No |
| Reports | Yes | Yes | No | No |
| Settings / users | Yes | No | No | No |

Roles map to permissions in `domain/permissions.js`; route checks use shared `requirePermission` middleware, not repeated role comparisons.

## Audit and compatibility

Authenticated table and settlement events pass the logged-in `userId` as `actorId`. JSON remains the production store. Existing backup/restore copies the additive user and audit data unchanged. Existing API paths are retained; protected operations now return `401` when logged out and `403` when the role lacks permission.

## Sprint 6 recommendation

Add an owner-only staff-management screen and password-change flow, then require the bootstrap password to be changed before normal operation.
