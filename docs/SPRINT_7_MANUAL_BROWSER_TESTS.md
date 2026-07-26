# Sprint 7 Manual Browser Test Checklist

Precondition: use OWNER, MANAGER, CASHIER, STAFF accounts; set a short timeout only on a test copy.

| Role / scenario | Steps | Expected | Pass/Fail |
|---|---|---|---|
| OWNER staff management | Open Staff, add/edit/disable/enable/reset a user | Data refreshes; no hash is shown | |
| OWNER sessions | Open Active Sessions, force logout another session | Target returns to login; current stays active | |
| OWNER settings | Set valid security values | Server returns saved values | |
| MANAGER sessions | Open Active Sessions | Read-only, no force logout | |
| CASHIER/STAFF | Open navigation | No staff/session/security menus | |
| First login | Login to reset account | Forced password page appears | |
| Warning | Wait until configured warning period | Modal shows; refresh works | |
| Expiry | Leave tab idle past timeout | Login page and expiry message appear | |
