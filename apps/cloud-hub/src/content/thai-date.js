'use strict';

// Thai date text for posts: "เสาร์ 12 ธ.ค. 2569" (Buddhist year = CE + 543), Bangkok time.
const { localDate, localWeekday } = require('../agent/time');

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

/** "YYYY-MM-DD" → { y, m, d } numbers. */
function splitDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** Weekday (0 = Sunday) of a calendar date "YYYY-MM-DD". */
function weekdayOf(iso) {
  const { y, m, d } = splitDate(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "12 ธ.ค. 2569" */
function thaiDate(iso) {
  const { y, m, d } = splitDate(iso);
  return `${d} ${MONTHS[m - 1]} ${y + 543}`;
}

/** "เสาร์ 12 ธ.ค. 2569" */
function thaiDateWithWeekday(iso) {
  return `${WEEKDAYS[weekdayOf(iso)]} ${thaiDate(iso)}`;
}

/** Promotion days [1,2,3,4,5] → "จันทร์–ศุกร์"; all/none → "ทุกวัน". */
function daysText(days) {
  if (!days || !days.length || days.length === 7) return 'ทุกวัน';
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const consecutive = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  if (consecutive && sorted.length >= 3) return `${WEEKDAYS[sorted[0]]}–${WEEKDAYS[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => WEEKDAYS_SHORT[d]).join(' ');
}

/** End of a Bangkok calendar day (23:59:59.999 +07:00) as epoch ms. */
function endOfLocalDay(iso) {
  const { y, m, d } = splitDate(iso);
  return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 7 * 60 * 60 * 1000;
}

module.exports = { thaiDate, thaiDateWithWeekday, daysText, endOfLocalDay, weekdayOf, splitDate, localDate, localWeekday, MONTHS, WEEKDAYS };
