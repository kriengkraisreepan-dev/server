# Security Risks — Sprint -1

This is an audit of observed code, not a penetration test. No system-wide security refactor is performed in Sprint -1.

| Priority | Finding | Evidence / impact | Recommended sprint action |
|---|---|---|---|
| Critical | No current critical private-key leak found | No license key exists in the repository; no production private key was created | Preserve this property; add secret scanning before license work |
| High | No authentication or authorization | Every state, backup, bill deletion, restore, and relay endpoint is callable by any client able to reach the process | Identity/roles and backend authorization before LAN/mobile/remote use |
| High | Runtime data not previously ignored and co-located with program files | `data/store.json` and backups were untracked under repository/app path | `.gitignore` added; move to User Data with Electron/database work |
| High | Destructive API actions lack audit/role/strong validation | Restore, delete backup, delete bill mutate or remove data | Add roles, audit log, confirmation policy, retention/void model |
| High | JSON store has no atomic transaction/concurrency protection | Whole-file synchronous rewrites can lose/corrupt data on interruption/concurrent use | SQLite/WAL + transactions and backup recovery |
| Medium | Input validation is partial | Settings is a free merge; quantities, payment method, dates/periods have weak validation | DTO/schema validation and allow-lists at API boundary |
| Medium | Output encoding is inconsistent | Receipt helper encodes some output, while SPA template interpolation uses stored strings directly | Central output encoding/DOM APIs and Content Security Policy |
| Medium | ESP32 command trust boundary is weak | Configured base URL and relay route accept calls without authorization; HTTP is used | backend permission guard, network isolation, device authentication/TLS where possible |
| Medium | Backup restore accepts any parseable JSON | No schema/version/checksum validation before replacement | signed/hashed backup metadata, schema validation, staged restore |
| Medium | Error handling/logging is minimal | No error middleware or structured redacted logging was found | safe error responses, owner-readable logs, no stack traces in production |
| Low | SQL injection | No SQL is present, so none is currently observed | When SQLite is added, use prepared statements only; never compose SQL from input |
| Low | Path traversal | Backup filename uses `basename` plus strict timestamp regex | Retain guard; validate canonical path remains under backup directory |
| Low | CORS | No CORS middleware found; Express does not add broad CORS by default | Define an explicit policy when renderer/mobile origins are introduced |
| Deferred | Electron hardening | Electron, preload, IPC, `nodeIntegration`, and `contextIsolation` do not exist yet | Require `nodeIntegration:false`, `contextIsolation:true`, narrow preload API, validated IPC from the first Electron sprint |
| Deferred | Passwords/secrets | No password storage or app secrets were found | Use OS credential/key protection where required; never ship private signing keys |

## Security gate for later distribution

Before Windows installer, LAN access, mobile ordering, or remote management: complete role-based backend authorization, SQLite integrity/backup work, Electron process isolation, signed licenses, signed updates, and dependency/security review. UI hiding alone must never enforce Standard/Pro rights.
