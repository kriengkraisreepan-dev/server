# Sprint 7 Final Release

## Executive summary

Sprint 7 delivers staff/account security foundations, role-gated staff and session UI, configurable session timeout/security settings, forced password change, and JSON-compatible persistence.

## Password policy

Minimum length: 8 characters. Complexity: none. Numeric-only passwords: allowed. Hashing: `crypto.scrypt`. A new empty store creates only one `admin` OWNER with a hashed default `123456789` (or valid `LUCKY_BOOTSTRAP_PASSWORD`) and forces password change. Existing users and admin hashes are never overwritten.

## Features completed

- Authentication, roles, permission middleware, staff APIs/UI, reset/change password.
- Account lock policy and session lifecycle: creation, status, warning, renewal, expiry, revoke.
- Owner security settings and dashboard security summary.
- Critical Disable/Enable and Force Logout browser confirms now use the application modal.

## Testing

Automated syntax and Sprint 5, 6, 7, and 7D tests pass. Manual browser checklist is provided in `SPRINT_7_MANUAL_BROWSER_TESTS.md`; it remains a required final on-device validation before operational rollout.

## Known limitations

Some legacy destructive confirmation dialogs outside staff/session workflows remain browser dialogs. Browser checklist was not executed against a production store.

## Sprint 8 recommendation

After approval, start POS/product work without changing the established authentication, session, billing, or receipt foundations.
