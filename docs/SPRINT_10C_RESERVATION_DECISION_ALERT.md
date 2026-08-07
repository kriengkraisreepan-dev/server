# Sprint 10C — Reservation Decision Alert

## Revised rule

When a reservation becomes due, the system changes it to `AWAITING_DECISION` and queues a visual alert. It does not take a table, enable a relay, or start a table session automatically.

Staff can select **Open now** or **Defer**. Open now selects only a free table, turns on its relay, starts the normal table session and billing timer, then sets `OPENED_WAITING_CHECK_IN`. Check-in only records customer arrival; it does not reset the timer or send another relay command.

Defer uses `settings.reservation.deferMinutes` and gives deferred reservations priority in the next alert/queue ordering.

## No-show

At `checkInDeadlineAt`, an opened reservation without check-in is cancelled without a bill. Its session is cancelled, its relay is turned off, the table is released, and an available deposit becomes `FORFEITED`. Only that forfeited deposit is recognised as no-show revenue; the abandoned session timer is never bill revenue.

## APIs

- `GET /api/reservation-alerts/pending`
- `GET /api/reservations/priority-queue`
- `POST /api/reservations/:id/open-now`
- `POST /api/reservations/:id/defer`
- `POST /api/reservations/:id/check-in`
- `POST /api/tables/:tableId/reservation-check-in`

All mutations return structured JSON errors, including `VERSION_CONFLICT`, `RESERVATION_NOT_AWAITING_DECISION`, `NO_TABLE_AVAILABLE`, and `RESERVATION_NOT_WAITING_CHECK_IN`.

## Settings

`alertEnabled`, `alertSoundEnabled`, `alertSoundVolume`, `alertRepeatMinutes`, `deferMinutes`, `checkInGraceMinutes`, `deferredPriorityEnabled`, and `autoForfeitNoShowDeposit` are held under `settings.reservation`. No timing value is a business-logic constant.

## Audit events

`RESERVATION_DUE`, `RESERVATION_ALERTED`, `RESERVATION_OPEN_NOW_SELECTED`, `RESERVATION_DEFERRED`, `RESERVATION_WAITING_TABLE`, `RESERVATION_TABLE_OPENED`, `RESERVATION_CHECKED_IN`, `RESERVATION_NO_SHOW_PROCESSED`, `DEPOSIT_FORFEITED`, and `NO_SHOW_REVENUE_RECOGNIZED`.

## Known limitations

- Browser audio can be blocked until an initial user interaction; the visual modal is always used.
- Manual browser validation still requires a non-production test store and staff accounts.
- Existing historical reservation records remain readable; new fields are additive.

No commit or tag was made.
