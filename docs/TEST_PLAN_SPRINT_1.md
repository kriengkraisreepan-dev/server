# Sprint 1 — Test Plan

| Area | Automated foundation coverage | Follow-up coverage |
|---|---|---|
| Money | baht/satang conversion and invalid decimal rejection | boundary and locale matrix |
| Pricing | hourly pro-rata, minimum charge, snapshot immutability | minute/day/time-band selection and rounding matrix |
| Settings | legacy rate conversion, backup interval, timezone rejection | route payload compatibility and persistence rollback |
| Session | open, duplicate table rejection, pause/resume, close, cancel, invalid transition | real JSON persistence and later SQLite repository contract suite |
| Existing app | Node syntax and read-only API startup smoke test | UI/manual timing, relay hardware, full checkout regression |

Run foundation tests with `node tests/sprint1-foundation.test.js`. They use an in-memory JSON-shaped fixture and never change `data/store.json`.
