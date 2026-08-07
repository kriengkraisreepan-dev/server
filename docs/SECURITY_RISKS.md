# Security Risks

This document began as the Sprint -1 code audit. Later controls are noted without erasing the original risk history.

| Priority | Finding | Current status / remaining action |
|---|---|---|
| Critical | No current critical private-key leak found | Preserved; production private key has not been created and secret scans remain required |
| High | No authentication or authorization | Addressed by later authentication/role phases; keep backend permission regression |
| High | Runtime data co-located with program files | Phase 6A adds trusted `%LOCALAPPDATA%` separation and transactional legacy handoff; manual Windows acceptance remains pending |
| High | Destructive actions lacked audit/role validation | Addressed incrementally by later governance phases; keep regression coverage |
| High | JSON writes lacked interruption safety | Atomic JSON writes/recovery now exist; future database work remains a separate gate |
| Medium | Input validation was partial | Improved incrementally; retain allowlists at API boundaries |
| Medium | Output encoding/CSP | Output helpers exist; Phase 6A adds CSP, but legacy inline styles still require `style-src 'unsafe-inline'` |
| Medium | ESP32 trust boundary | Device authentication and nonce/HMAC verification now exist; HTTP/network isolation remains relevant |
| Medium | Backup validation | Verified backup/integrity work exists; preserve staged restore checks |
| Medium | Error handling/logging | Structured redacted operational logging exists; never log credentials or stack/path details to Browser |
| Low | SQL injection | No SQL is present; use prepared statements if introduced |
| Low | Path traversal | Canonical path and allowlist controls exist; retain tests |
| Low | CORS | No broad CORS is enabled; define policy before introducing additional origins |

## Phase 6A residual risks

- CSP has no `unsafe-eval`, but still permits inline style for the existing UI. Move styles into self-hosted stylesheets before removing this exception in a separate hardening change.
- Electron `43.2.0` is an internal development dependency. Product Authenticode/package signing is not part of Phase 6A.
- Manual Windows/Electron acceptance is `PENDING`.
- Customer Data uses filesystem permissions available to the Backend account; DPAPI/secret-store expansion is outside this task.
- A short race exists between ephemeral port reservation and Backend bind; any conflict fails closed through readiness timeout.
- Migration recovery copies contain customer data and require the same protection as the active database.

Production distribution, signing key, installer and offline update remain blocked until their Phase 6B/6C gates are approved.

Phase 5.5 Revision 2 adds sender-validated Backup Save As IPC and blocks browser-supplied Hardware credentials in production-like/Internal Test builds. Portable export rejects DPAPI references and credentials; ambiguous or missing vault sources fail closed to USB reauthentication. See `PHASE5_5_MANUAL_DEFECT_RESOLUTION.md`.
