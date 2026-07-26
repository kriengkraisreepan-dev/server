# Sprint 6: Staff Management & Account Security

OWNER-only APIs manage staff without deleting records: create, edit display name/role, disable/enable, and reset passwords. Users retain an additive security state: failed count, temporary lock time, last login, password change time, and required password change flag.

Password policy: 10+ characters with uppercase, lowercase, number, and special character. Five incorrect passwords lock the account for 15 minutes. Server sessions expire after 8 hours of inactivity. Account events are appended to the existing audit trail with actor and target user IDs.

New APIs: `GET/POST /api/users`, `PATCH /api/users/:id`, `PATCH /api/users/:id/status`, and `PATCH /api/users/:id/password`. Owner may reset a staff password; a user may change only their own password while supplying the current password.

Sprint 7 recommendation: complete the owner-facing staff-management and forced-password-change UI, then add account recovery policy only after a secure offline recovery decision.
