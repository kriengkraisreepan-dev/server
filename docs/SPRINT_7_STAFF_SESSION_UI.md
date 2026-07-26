# Sprint 7 Staff and Session UI

Completed UI uses existing user and session APIs: Staff Management, My Account password change, Active Sessions, forced first-login password change, Security Settings, and dashboard security summary. Security Settings defaults are timeout 480 minutes, warning 5 minutes, five login attempts, and 15-minute lock duration. Warning must be less than timeout.

Sprint 7D policy update: passwords have a minimum length of 8 characters with no complexity requirements. Numeric-only passwords are allowed. New-store bootstrap uses `admin` / `123456789` (or a valid `LUCKY_BOOTSTRAP_PASSWORD` override), is hashed with `crypto.scrypt`, and forces immediate password change.

Session lifecycle: login creates session; UI polls status every 30 seconds; warning uses server-provided remaining time; refresh renews activity; expiry returns to login; OWNER may revoke other sessions. MANAGER is read-only for sessions. JSON remains production and all settings are additive.
