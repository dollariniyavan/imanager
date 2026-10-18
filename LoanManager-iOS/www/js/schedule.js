// Port of the due-schedule helpers from config.php (PHP strtotime semantics for +N day / +N month,
// including the overflow behaviour: 31 Jan + 1 month = 3 Mar).

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
// Local (device) calendar date as yyyy-mm-dd
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function currentMonth() { return todayStr().slice(0, 7); }
// Whole days between a stored date and today (local midnight to local midnight)
export function daysSince(dateStr) {
  const a = parseYmd(todayStr()), b = parseYmd(dateStr);
  if (!b) return 0;
  return Math.trunc((a - b) / 86400000);
}
export const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

export function addPeriod(date, n, unit) {
  const d = parseYmd(date);
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n); else d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

// periods: [{due_date, due_amount}] oldest first; collections: [{date, amount}] ascending
export function reconcileDueSchedule(periods, collections) {
  const pool = collections.map(c => ({ date: c.date, remaining: Number(c.amount) }));
  let pi = 0;
  const out = [];
  for (const p of periods) {
    let need = Number(p.due_amount), collected = 0, paidDate = null;
    while (need > 0.005 && pi < pool.length) {
      if (pool[pi].remaining <= 0.005) { pi++; continue; }
      const take = Math.min(need, pool[pi].remaining);
      collected += take; need -= take; pool[pi].remaining -= take; paidDate = pool[pi].date;
    }
    const status = collected <= 0.005 ? 'pending' : (need > 0.005 ? 'partial' : 'complete');
    out.push({ due_date: p.due_date, due_amount: round2(p.due_amount), collected: round2(collected), status, paid_date: paidDate });
  }
  return out;
}

export function installmentCount(type) {
  return type === '10weeks' ? 10 : type === '20weeks' ? 20 : type === 'monthly' ? 5 : 100;
}
export function borrowerDuePeriods(principal, type, startDate, asOf) {
  const count = installmentCount(type);
  const due = round2(principal / count);
  let n = 1, unit = 'day';
  if (type === '10weeks' || type === '20weeks') { n = 7; unit = 'day'; } else if (type === 'monthly') { n = 1; unit = 'month'; }
  const periods = [];
  for (let i = 1; i <= count; i++) {
    const d = addPeriod(startDate, n * i, unit);
    if (d > asOf) break;
    periods.push({ due_date: d, due_amount: due });
  }
  return periods;
}
export function monthlyDuePeriods(dueAmount, startDate, endDate) {
  const periods = [];
  for (let i = 1; i <= 1200; i++) {
    const d = addPeriod(startDate, i, 'month');
    if (d > endDate) break;
    periods.push({ due_date: d, due_amount: dueAmount });
  }
  return periods;
}
// Full calendar months between two dates (PHP DateTime::diff y*12+m)
export function fullMonthsBetween(startStr, endStr) {
  const s = parseYmd(startStr), e = parseYmd(endStr);
  if (!s || !e || !(e > s)) return 0;
  let m = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  if (e.getUTCDate() < s.getUTCDate()) m--;
  return Math.max(0, m);
}
