# Sprint 2 — Runtime Integration & Billing Modernization

## Runtime integration

Existing JSON remains the live store. `JsonSessionRepository` now persists additive `tableSessions` history and `runtimeSessionId` on a table only when a new session is opened. Legacy table fields (`status`, `memberId`, `startTime`, `items`) remain present so existing UI/API consumers continue working.

```text
POST /api/tables/:id/start  -> TableSessionService.openSession
POST /api/tables/:id/pause  -> TableSessionService.pauseSession
POST /api/tables/:id/resume -> TableSessionService.resumeSession
POST /api/tables/:id/checkout -> TableSessionService.closeSession -> bill adapter
POST /api/tables/:id/cancel -> TableSessionService.cancelSession
```

The old start and checkout paths are retained. Pause, resume and cancel are additive paths. The table card gets small lifecycle controls only; no main layout was changed.

## Billing and money policy

- New session pricing is always integer satang.
- At open, the selected default pricing profile is copied into `pricingSnapshot`.
- Preview totals use unrounded internal satang; closing applies the profile's `UP_TO_BAHT` rule once.
- New bills retain compatible baht API fields (`playAmount`, `foodAmount`, `total`) and add `*Satang` fields plus pricing snapshot for audit.
- New bill totals are rounded upward to whole baht. The renderer/receipt formatter displays THB with zero fraction digits.
- A table already playing before this change has no snapshot, so it uses the previous float calculation only until it is closed. This avoids retroactively changing an in-progress customer's amount.

## Compatibility adapter

`enrichTable` adapts a runtime session into the existing table API shape: `elapsedSeconds`, `currentPrice`, `member`, and legacy status values remain available. No SQLite route or runtime was introduced.

## Validation

The service/repository rejects a missing table, duplicate active table session, duplicate pause, resume without pause, close without session, cancel after close, negative duration, invalid pricing profile, and negative satang values. Route errors are returned as clear JSON error messages.

## Regression result

For 30 minutes, 1 hour and 2 hours at 100 THB/hour with a 50 THB minimum, legacy and new totals are equal. At 1 hour 1 second, legacy pro-rating produces approximately 100.03 THB while the new final-charge policy produces 101 THB; this is the required one-time upward whole-baht rounding difference.
