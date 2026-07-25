# Proposed Architecture — Sprint -1

## Objective

Evolve the verified current Express SPA without a rewrite into one Lucky Snooker Manager codebase whose verified license enables Standard or Pro modules. Current JSON storage is a transitional implementation; future durable data belongs in SQLite under User Data.

```text
Electron main process (future Windows host)
  ├─ app lifecycle / userData path / printing / update hand-off
  ├─ preload bridge (narrow, validated IPC only)
  └─ Local application host
       ├─ API / application services
       │   ├─ Core: config, access, audit, backup, license verification
       │   ├─ Standard: tables, billing, POS, catalog, inventory, members, points, reports, ESP32
       │   └─ Pro: reservations, KDS/bar, ordering, coupons, advanced dashboard/export/remote
       ├─ SQLite repository + migration runner
       └─ module/feature access guard

Renderer SPA
  ├─ shared UI/navigation
  └─ feature-aware screens; visibility is not authorization
```

## Current-to-target mapping (proposal only)

| Current path | Future responsibility | Target conceptual location |
|---|---|---|
| `index.js` | bootstrap, API routes, JSON persistence mixed together | `src/main/`, `src/server/`, `src/database/` |
| `public/index.html`, CSS, `public/js/app.js` | renderer shell and UI | `src/renderer/` |
| `public/js/modules/` | legacy browser modules, several unused/empty | map one at a time to `src/modules/*`; do not move in Sprint -1 |
| `data/store.json`, `data/backups/` | runtime data | User Data `database/`, `backups/` |
| absent | license verification | `src/license/` and User Data `license/` |
| absent | shared contracts | `src/shared/` |
| absent | migrations | `src/database/migrations/` |

No files are moved by this sprint. The conceptual target root is:

```text
LuckySnookerManager/
  src/{main,renderer,server,modules/{core,standard,pro},license,database/migrations,shared}
  public/ tests/ scripts/ docs/ build/
```

## Design rules

1. Program files and all customer data are separate.
2. Backend services, not renderer menus, enforce license/module access and roles.
3. Every destructive financial or backup operation is audited and permission-checked.
4. Migrations are append-only, transactional, backed up, and versioned.
5. Electron main/preload/renderer run with least privilege.
6. The License Manager and Updater are separate executables and signing domains.
# Sprint 3 runtime extension

The JSON runtime now applies `Route → TableSessionService / BillingService / PaymentService → JsonSessionRepository / JsonBillingRepository → store.json`. Financial and audit writes are isolated from Express routes; SQLite remains a future migration target only.
