'use strict';

// Shop-local time (Asia/Bangkok, UTC+7, no DST) for tool results and replies.
const TZ = 'Asia/Bangkok';

function parts(ms) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}

/** "HH:MM" in Bangkok time. */
function hhmm(msOrIso) {
  const ms = typeof msOrIso === 'string' ? Date.parse(msOrIso) : msOrIso;
  const p = parts(ms);
  return `${p.hour}:${p.minute}`;
}

/** "YYYY-MM-DD" in Bangkok time. */
function localDate(ms) {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** 0 = Sunday … 6 = Saturday, Bangkok time (same numbering as Snapshot.promotions[].days). */
function localWeekday(ms) {
  return WEEKDAYS[parts(ms).weekday];
}

module.exports = { hhmm, localDate, localWeekday, TZ };
