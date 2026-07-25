# Current Project Audit — Sprint -1

Audit date: 2026-07-26. Scope is the repository at audit time; no business feature was changed.

## Identity and entry points

- The repository package is named `server`; the UI and README identify the product as **88 Snooker Club Manager**, while the requested target product name is **Lucky Snooker Manager**. The naming decision is not made by this sprint.
- Server entry point: `index.js`.
- Browser entry point: `public/index.html`, which loads only `public/js/app.js`.
- Start command: `npm start` (`node index.js`), default port `3000` or `PORT`.
- Test command: `npm test` (`node --check index.js`). It is syntax-only, not a behavioural test.
- Git HEAD at audit: `b76436d Initial working version`. The working tree already had modifications and untracked runtime data before Sprint -1 documentation was added; they are preserved.

## Confirmed technology inventory

| Technology | Status | Evidence |
|---|---|---|
| Node.js | Present | Node v24.18.0 in audit environment; `index.js` CommonJS |
| Express | Present | `express` 5.2.1 is the only declared direct dependency |
| HTML/CSS/JavaScript | Present | `public/index.html`, `public/css/style.css`, browser JavaScript |
| SQLite | **Not present** | No SQLite dependency, `.db`/`.sqlite` files, SQL, migrations, or DB access code found |
| Electron | **Not present** | No Electron dependency, main/preload process, or builder configuration found |
| ESP32/Relay | Partial integration | Server optionally calls `ESP32_BASE_URL/relay/{channel}?state=on|off`; firmware is absent |
| Git | Present | `.git` exists and history is available |

## Confirmed current functions

The single Express process serves the static SPA and JSON APIs. The SPA currently covers dashboard/table status, opening tables, optional member association, POS items, checkout, manual QR-payment confirmation, bills, receipts, basic member and product creation, reports, relay commands, and JSON backup/restore.

Current persistence is a single in-memory `store` loaded from `data/store.json` and synchronously rewritten on saves. `data/backups/` contains JSON snapshots. This is not a relational database.

## Current limitations observed

- No authentication, role model, API authorization, license enforcement, or edition/module boundary exists.
- No Electron application, installer, updater, SQLite schema, schema version, migration system, automated test suite, or CI configuration exists.
- Legacy files remain in `public/js/modules/`; several are empty and `public/index.html` does not load them. `public/js/settings.js` is also not loaded by the current HTML. They are not removed in this sprint.
- `data/` is inside the application repository path and was untracked at audit time. This is unsafe for a future updater and risks accidental Git commits; `.gitignore` now excludes it without moving or deleting it.
