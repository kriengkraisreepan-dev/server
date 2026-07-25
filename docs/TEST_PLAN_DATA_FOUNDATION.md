# Sprint 0 — Test Plan

| Area | Required test | Current status |
|---|---|---|
| JSON validation | valid store, missing arrays, duplicate IDs/codes, invalid values, broken payment reference, warning-only historical reference | Valid real store tested; negative automated cases planned |
| Migration | fresh DB applies each migration once, rerun is no-op, changed checksum fails, failed SQL rolls back | Fresh DB and version history tested; negative cases planned |
| Import | dry run writes nothing; successful import checks rows/FKs/integrity; existing target is refused; source JSON remains unchanged | Real-store dry run and isolated Temp import tested |
| Backup | JSON and SQLite copy get checksum manifest; altered file fails verification; restore is staged | Utility added; automated tests planned |
| Recovery | interrupted import leaves no published target; failed migration restores verified backup | Design documented; failure injection planned |
| Compatibility | current `npm start`, existing API routes and UI still work | syntax/start/read-only API smoke test completed |

Production conversion, SQLite performance/concurrency, Electron user-data locations, ESP32 hardware, and restore UX are out of scope and were not tested in this sprint.
