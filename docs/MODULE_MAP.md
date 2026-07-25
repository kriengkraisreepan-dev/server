# Module Map — Sprint -1

## Current code classification

| Classification | Confirmed current code/features | Notes |
|---|---|---|
| Core | Express bootstrap, static serving, settings, tables, time charge, bills, backups | Concentrated in `index.js` and `public/js/app.js` |
| Standard candidate | table operation, basic POS/products, members, bills/receipt, reports, backup/restore, relay | Present only in a minimal form; many stated Standard requirements are not yet implemented |
| Pro candidate | none confirmed | Reservations, KDS, bar display, mobile/QR ordering, coupons, advanced dashboard/export/remote management do not exist |
| Shared | static UI, JSON API helper, money/time formatting, legacy JavaScript modules | Legacy module files should be catalogued before later consolidation |
| Infrastructure | JSON storage, JSON backups, optional ESP32 HTTP command, Git, npm | No SQLite, Electron, license, updater, tests, CI, or build tooling |

## Target module boundary

One Lucky Snooker Manager codebase must own core behaviour. Future modules should be registered in a backend module registry and a shared feature-access service, not only hidden in the renderer.

```text
Core: configuration, identity, access control, audit, database, backup, printing
Standard: table sessions, billing, POS, products, inventory, members, points, basic reports, ESP32
Pro: reservations, kitchen/bar displays, staff mobile ordering, QR ordering, coupons,
     advanced dashboard/export, remote management
Shared: DTOs, validation, money/time utilities, module identifiers, IPC/API contracts
```

Each module should declare a stable module identifier, required edition, migrations, backend routes/services, renderer navigation, and a capability check. Backend services must reject a call when the license does not enable its capability; renderer navigation is only a convenience layer.
