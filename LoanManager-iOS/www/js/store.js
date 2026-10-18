// ==========================================================
// LOCAL API  -  replaces borrower_api.php, interest_api.php, rent_api.php, moi_api.php and
// reports_api.php.  Same URLs / same JSON shapes, so the existing screens keep working;
// everything now runs against the SQLite database stored on the phone.
//
// `adapter` = { query(sql, params) -> rows[], run(sql, params) -> {lastId, changes}, batch([{statement, values}]) }
// ==========================================================
import {
  todayStr, currentMonth, daysSince, round2, installmentCount, borrowerDuePeriods,
  monthlyDuePeriods, reconcileDueSchedule, fullMonthsBetween, parseYmd,
} from './schedule.js';

const normMobile = raw => {
  let d = String(raw ?? '').replace(/\D+/g, '').replace(/^0+/, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length > 10) d = d.slice(-10);
  return d;
};
const dec = v => (v === null || v === undefined || v === '') ? null : Number(v).toFixed(2); // MySQL DECIMAL(…,2) look
const num = v => round2(v || 0);
const str = v => String(v ?? '').trim();
const fl = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const intv = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

// "AND (...)" fragment for list queries (same rules as search_clause() in config.php)
function searchClause(q, cols, mobileCols = []) {
  q = str(q);
  if (!q) return ['', []];
  const terms = q.split(/\s*,\s*/).filter(Boolean);
  const parts = [], params = [];
  for (const t of terms) {
    for (const c of cols) { parts.push(`CAST(${c} AS TEXT) LIKE ?`); params.push('%' + t + '%'); }
    const digits = t.replace(/\D+/g, '');
    if (digits) for (const c of mobileCols) {
      parts.push(`REPLACE(REPLACE(REPLACE(${c},' ',''),'-',''),'+','') LIKE ?`);
      params.push('%' + digits + '%');
    }
  }
  return parts.length ? [' AND (' + parts.join(' OR ') + ')', params] : ['', []];
}
const failMsg = e => /UNIQUE/i.test(String(e && e.message)) ? 'This mobile number already exists.' : String((e && e.message) || e);

export function createApi(adapter) {
  const q = (sql, p = []) => adapter.query(sql, p);
  const one = async (sql, p = []) => (await q(sql, p))[0] || null;
  const run = (sql, p = []) => adapter.run(sql, p);

  const fmtCust = (r, decCols) => { const o = { ...r }; decCols.forEach(c => { o[c] = dec(o[c]); }); return o; };
  const fmtRows = (rows, decCols) => rows.map(r => fmtCust(r, decCols));
  const BOR = ['principal', 'balance'];
  const INT = ['principal', 'principal_balance', 'rate_of_interest', 'total_interest_collected'];
  const RNT = ['rent_amount'];
  const COLL = ['amount'];

  // ------------------------------------------------------ BORROWER
  const borrower = {
    async list(d) {
      const [w, p] = searchClause(d.q, ['name', 'mobile', 'principal', 'balance', 'due_count', 'day_count'], ['mobile']);
      const rows = await q(`SELECT * FROM borrower_customers WHERE 1=1 ${w} ORDER BY id DESC`, p);
      rows.forEach(r => { r.day_count = daysSince(r.transaction_date); });
      return { rows: fmtRows(rows, BOR) };
    },
    async add(d) {
      const name = str(d.name), village = str(d.village), mobile = normMobile(d.mobile);
      const principal = fl(d.principal), date = d.transaction_date || todayStr(), type = d.payment_type || '100days';
      if (!name || principal <= 0) return { success: false, message: 'Name and principal are required.' };
      if (mobile.length !== 10) return { success: false, message: 'Enter a valid 10-digit mobile number.' };
      try {
        const r = await run(`INSERT INTO borrower_customers (name,village,mobile,principal,balance,transaction_date,payment_type,due_count,day_count)
          VALUES (?,?,?,?,0,?,?,0,0)`, [name, village, mobile, principal, date, type]);
        return { success: true, id: r.lastId, mobile, message: 'Saved successfully.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
    async set_active(d) { return setActive('borrower_customers', d); },
    async view(d) {
      const id = intv(d.id);
      const c = await one('SELECT * FROM borrower_customers WHERE id=?', [id]);
      if (!c) return { success: false, message: 'Not found' };
      const history = await q('SELECT * FROM borrower_collections WHERE customer_id=? ORDER BY collection_date DESC, id DESC', [id]);
      c.day_count = daysSince(c.transaction_date);
      c.pending_amount = c.principal - c.balance;
      c.suggested_due = round2(c.principal / installmentCount(c.payment_type));
      const periods = borrowerDuePeriods(c.principal, c.payment_type, c.transaction_date, todayStr());
      const asc = [...history].reverse().map(r => ({ date: r.collection_date, amount: Number(r.amount) }));
      const schedule = reconcileDueSchedule(periods, asc);
      return { success: true, customer: fmtCust(c, BOR), history: fmtRows(history, COLL), schedule };
    },
    async pay_due(d) {
      const id = intv(d.id), amount = fl(d.amount), date = d.date || todayStr();
      if (id <= 0 || amount <= 0) return { success: false, message: 'Invalid data' };
      const row = await one('SELECT principal, balance, is_active FROM borrower_customers WHERE id=?', [id]);
      if (!row) return { success: false, message: 'Not found' };
      if (!+row.is_active) return { success: false, message: 'This borrower is inactive. Set it to Active to accept payments.' };
      let nb = round2(row.balance + amount);
      if (nb > row.principal) nb = row.principal;
      const status = nb >= row.principal ? 'complete' : 'partial';
      try {
        await adapter.batch([
          { statement: 'INSERT INTO borrower_collections (customer_id, collection_date, amount, status) VALUES (?,?,?,?)', values: [id, date, amount, status] },
          { statement: 'UPDATE borrower_customers SET balance=?, due_count = due_count + 1 WHERE id=?', values: [nb, id] },
        ]);
        return { success: true, status, message: 'Due collected.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
  };

  async function setActive(table, d) {
    const id = intv(d.id), active = intv(d.active) ? 1 : 0;
    try { await run(`UPDATE ${table} SET is_active=? WHERE id=?`, [active, id]); return { success: true, message: 'Updated.' }; }
    catch (e) { return { success: false, message: failMsg(e) }; }
  }

  // ------------------------------------------------------ INTEREST
  const interest = {
    async list(d) {
      const [w, p] = searchClause(d.q, ['name', 'mobile', 'principal', 'principal_balance', 'rate_of_interest',
        'transaction_date', 'no_of_payments', 'total_interest_collected'], ['mobile']);
      return { rows: fmtRows(await q(`SELECT * FROM interest_customers WHERE 1=1 ${w} ORDER BY id DESC`, p), INT) };
    },
    async add(d) {
      const name = str(d.name), village = str(d.village), mobile = normMobile(d.mobile);
      const principal = fl(d.principal), rate = fl(d.rate_of_interest), date = d.transaction_date || todayStr();
      if (!name || principal <= 0) return { success: false, message: 'Name and principal are required.' };
      if (mobile.length !== 10) return { success: false, message: 'Enter a valid 10-digit mobile number.' };
      try {
        const r = await run(`INSERT INTO interest_customers (name,village,mobile,principal,principal_balance,rate_of_interest,transaction_date,payment_type)
          VALUES (?,?,?,?,?,?,?,'100days')`, [name, village, mobile, principal, principal, rate, date]);
        return { success: true, id: r.lastId, mobile, message: 'Saved successfully.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
    async set_active(d) { return setActive('interest_customers', d); },
    async view(d) {
      const id = intv(d.id);
      const c = await one('SELECT * FROM interest_customers WHERE id=?', [id]);
      if (!c) return { success: false, message: 'Not found' };
      const ih = await q('SELECT * FROM interest_collections WHERE customer_id=? ORDER BY collection_date DESC, id DESC', [id]);
      const ph = await q('SELECT * FROM interest_principal_collections WHERE customer_id=? ORDER BY collection_date DESC, id DESC', [id]);
      const today = todayStr();
      let end = today;
      if (c.principal_balance <= 0) {
        const lp = await one('SELECT MAX(collection_date) AS d FROM interest_principal_collections WHERE customer_id=?', [id]);
        if (lp && lp.d) end = lp.d;
      }
      const monthlyDue = round2(c.principal * c.rate_of_interest / 100);
      const periods = monthlyDuePeriods(monthlyDue, c.transaction_date, end);
      const asc = [...ih].reverse().map(r => ({ date: r.collection_date, amount: Number(r.amount) }));
      return { success: true, customer: fmtCust(c, INT), interest_history: fmtRows(ih, COLL),
               principal_history: fmtRows(ph, COLL), interest_schedule: reconcileDueSchedule(periods, asc) };
    },
    async collect_interest(d) {
      const id = intv(d.id), amount = fl(d.amount), date = d.date || todayStr();
      if (id <= 0 || amount <= 0) return { success: false, message: 'Invalid data' };
      const row = await one('SELECT principal_balance, is_active FROM interest_customers WHERE id=?', [id]);
      if (!row) return { success: false, message: 'Customer not found' };
      if (!+row.is_active) return { success: false, message: 'This customer is inactive. Set it to Active to accept payments.' };
      const status = row.principal_balance <= 0 ? 'complete' : 'partial';
      try {
        await adapter.batch([
          { statement: 'INSERT INTO interest_collections (customer_id, collection_date, amount, status) VALUES (?,?,?,?)', values: [id, date, amount, status] },
          { statement: 'UPDATE interest_customers SET total_interest_collected = ROUND(COALESCE(total_interest_collected,0) + ?, 2), no_of_payments = COALESCE(no_of_payments,0) + 1 WHERE id = ?', values: [amount, id] },
        ]);
        return { success: true, status, message: 'Interest collected.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
    async collect_principal(d) {
      const id = intv(d.id), amount = fl(d.amount), date = d.date || todayStr();
      if (id <= 0 || amount <= 0) return { success: false, message: 'Invalid data' };
      const row = await one('SELECT principal_balance, is_active FROM interest_customers WHERE id=?', [id]);
      if (!row) return { success: false, message: 'Customer not found' };
      if (!+row.is_active) return { success: false, message: 'This customer is inactive. Set it to Active to accept payments.' };
      const bal = Number(row.principal_balance);
      if (amount - bal > 0.005) return { success: false, message: 'Amount exceeds remaining principal balance.' };
      const nb = round2(bal - amount);
      const status = nb <= 0 ? 'complete' : 'partial';
      try {
        await adapter.batch([
          { statement: 'INSERT INTO interest_principal_collections (customer_id, collection_date, amount, status) VALUES (?,?,?,?)', values: [id, date, amount, status] },
          { statement: 'UPDATE interest_customers SET principal_balance = ? WHERE id = ?', values: [nb, id] },
        ]);
        return { success: true, status, message: 'Principal collected.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
  };

  // ------------------------------------------------------ RENT
  const rent = {
    async list(d) {
      const [w, p] = searchClause(d.q, ['rc.name', 'rc.mobile', 'rc.rent_amount', 'rc.agreement_date'], ['rc.mobile']);
      const rows = await q(`SELECT rc.*, (SELECT MAX(rp.payment_date) FROM rent_payments rp WHERE rp.customer_id = rc.id) AS last_payment_date
        FROM rent_customers rc WHERE 1=1 ${w} ORDER BY rc.id DESC`, p);
      const cm = currentMonth();
      rows.forEach(r => { r.status = (r.last_payment_date && r.last_payment_date.slice(0, 7) === cm) ? 'paid' : 'pending'; });
      return { rows: fmtRows(rows, RNT) };
    },
    async add(d) {
      const name = str(d.name), village = str(d.village), mobile = normMobile(d.mobile);
      const amt = fl(d.rent_amount), date = d.agreement_date || todayStr();
      if (!name || amt <= 0) return { success: false, message: 'Name and rent amount are required.' };
      if (mobile.length !== 10) return { success: false, message: 'Enter a valid 10-digit mobile number.' };
      try {
        const r = await run(`INSERT INTO rent_customers (name,village,mobile,rent_amount,agreement_date,status) VALUES (?,?,?,?,?,'pending')`,
          [name, village, mobile, amt, date]);
        return { success: true, id: r.lastId, mobile, message: 'Saved successfully.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
    async set_active(d) { return setActive('rent_customers', d); },
    async view(d) {
      const id = intv(d.id);
      const c = await one('SELECT * FROM rent_customers WHERE id=?', [id]);
      if (!c) return { success: false, message: 'Not found' };
      const history = await q('SELECT * FROM rent_payments WHERE customer_id=? ORDER BY payment_date DESC, id DESC', [id]);
      const last = history[0] ? history[0].payment_date : null;
      c.status = (last && last.slice(0, 7) === currentMonth()) ? 'paid' : 'pending';
      const periods = monthlyDuePeriods(Number(c.rent_amount), c.agreement_date, todayStr());
      const asc = [...history].reverse().map(r => ({ date: r.payment_date, amount: Number(r.amount) }));
      return { success: true, customer: fmtCust(c, RNT), history: fmtRows(history, COLL), schedule: reconcileDueSchedule(periods, asc) };
    },
    async pay(d) {
      const id = intv(d.id), amount = fl(d.amount), date = d.date || todayStr();
      if (id <= 0 || amount <= 0) return { success: false, message: 'Invalid data' };
      const c = await one('SELECT is_active FROM rent_customers WHERE id=?', [id]);
      if (!c) return { success: false, message: 'Not found' };
      if (!+c.is_active) return { success: false, message: 'This record is inactive. Set it to Active to accept payments.' };
      const last = (await one('SELECT MAX(payment_date) AS d FROM rent_payments WHERE customer_id=?', [id]))?.d;
      if (last && last.slice(0, 7) === date.slice(0, 7)) return { success: false, message: 'Rent for this month has already been collected.' };
      try {
        await adapter.batch([
          { statement: 'INSERT INTO rent_payments (customer_id, payment_date, amount) VALUES (?,?,?)', values: [id, date, amount] },
          { statement: `UPDATE rent_customers SET status='paid' WHERE id=?`, values: [id] },
        ]);
        return { success: true, message: 'Rent payment recorded.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
  };

  // ------------------------------------------------------ MOI
  const moiFields = d => {
    const nz = v => { v = normMobile(v); return v === '' ? null : v; };
    return {
      nt: str(d.name_tamil), vt: str(d.village_tamil), city: str(d.city), info: str(d.information),
      tran: d.tran_date ? d.tran_date : null, mobile: nz(d.mobile), alt: nz(d.alternate_mobile),
      income: fl(d.income), exp: fl(d.expenditure),
    };
  };
  const moiOrder = d => d.sort === 'village_asc'
    ? "ORDER BY (village_tamil IS NULL OR village_tamil = ''), village_tamil ASC, id DESC" : 'ORDER BY id DESC';
  const moi = {
    async list(d) {
      let [w, p] = searchClause(d.q, ['name_tamil', 'village_tamil', 'mobile', 'alternate_mobile', 'city', 'income', 'expenditure', 'information'],
        ['mobile', 'alternate_mobile']);
      const v = str(d.village);
      if (v) { w += ' AND village_tamil = ?'; p.push(v); }
      const rows = await q(`SELECT * FROM moi_records WHERE 1=1 ${w} ${moiOrder(d)}`, p);
      return { rows: fmtRows(rows, ['income', 'expenditure']) };
    },
    async villages() {
      const rows = await q("SELECT DISTINCT village_tamil FROM moi_records WHERE village_tamil IS NOT NULL AND village_tamil <> '' ORDER BY village_tamil");
      return { villages: rows.map(r => r.village_tamil) };
    },
    async add(d) {
      const f = moiFields(d);
      try {
        const r = await run(`INSERT INTO moi_records (name_tamil,village_tamil,mobile,alternate_mobile,tran_date,city,income,expenditure,information)
          VALUES (?,?,?,?,?,?,?,?,?)`, [f.nt, f.vt, f.mobile, f.alt, f.tran, f.city, f.income, f.exp, f.info]);
        return { success: true, id: r.lastId, message: 'Saved successfully.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
    async update(d) {
      const id = intv(d.id);
      if (id <= 0) return { success: false, message: 'Invalid ID' };
      const f = moiFields(d);
      try {
        await run(`UPDATE moi_records SET name_tamil=?, village_tamil=?, mobile=?, alternate_mobile=?, tran_date=?, city=?,
          income=?, expenditure=?, information=?, up_dated=datetime('now','localtime') WHERE id=?`,
          [f.nt, f.vt, f.mobile, f.alt, f.tran, f.city, f.income, f.exp, f.info, id]);
        return { success: true, message: 'Updated successfully.' };
      } catch (e) { return { success: false, message: failMsg(e) }; }
    },
  };

  // ------------------------------------------------------ REPORTS
  const reports = {
    async data(d) {
      const from = d.from || todayStr(), to = d.to || todayStr();
      const R = (sql) => q(sql, [from, to]);
      const bCol = await R(`SELECT bc.collection_date AS date, c.name, c.village, bc.amount, bc.status FROM borrower_collections bc
        JOIN borrower_customers c ON c.id = bc.customer_id WHERE bc.collection_date BETWEEN ? AND ? ORDER BY bc.collection_date DESC, bc.id DESC`);
      const bNew = await R(`SELECT transaction_date AS date, name, village, principal AS amount, payment_type FROM borrower_customers
        WHERE transaction_date BETWEEN ? AND ? ORDER BY transaction_date DESC, id DESC`);
      const iCol = await R(`SELECT ic.collection_date AS date, c.name, c.village, ic.amount, ic.status FROM interest_collections ic
        JOIN interest_customers c ON c.id = ic.customer_id WHERE ic.collection_date BETWEEN ? AND ? ORDER BY ic.collection_date DESC, ic.id DESC`);
      const pCol = await R(`SELECT ipc.collection_date AS date, c.name, c.village, ipc.amount, ipc.status FROM interest_principal_collections ipc
        JOIN interest_customers c ON c.id = ipc.customer_id WHERE ipc.collection_date BETWEEN ? AND ? ORDER BY ipc.collection_date DESC, ipc.id DESC`);
      const iNew = await R(`SELECT transaction_date AS date, name, village, principal AS amount, rate_of_interest FROM interest_customers
        WHERE transaction_date BETWEEN ? AND ? ORDER BY transaction_date DESC, id DESC`);
      const rCol = await R(`SELECT rp.payment_date AS date, c.name, c.village, rp.amount FROM rent_payments rp
        JOIN rent_customers c ON c.id = rp.customer_id WHERE rp.payment_date BETWEEN ? AND ? ORDER BY rp.payment_date DESC, rp.id DESC`);
      const rNew = await R(`SELECT agreement_date AS date, name, village, rent_amount AS amount FROM rent_customers
        WHERE agreement_date BETWEEN ? AND ? ORDER BY agreement_date DESC, id DESC`);
      const sum = rows => num(rows.reduce((a, r) => a + Number(r.amount), 0));
      const f = rows => fmtRows(rows, ['amount']);
      return {
        from, to,
        borrower: { collections: f(bCol), collections_total: sum(bCol), new_entries: f(bNew), new_entries_total: sum(bNew) },
        interest: { interest_collections: f(iCol), interest_collections_total: sum(iCol), principal_collections: f(pCol),
                    principal_collections_total: sum(pCol), new_entries: f(iNew), new_entries_total: sum(iNew) },
        rent: { collections: f(rCol), collections_total: sum(rCol), new_entries: f(rNew), new_entries_total: sum(rNew) },
      };
    },

    async summary() {
      const names = { borrower: [], interest: [], rent: [], moi: [] };
      const today = todayStr();
      const pendingList = [];

      // ---- Borrower ----
      const r = await one(`SELECT COUNT(*) AS cnt, COALESCE(SUM(principal),0) AS principal, COALESCE(SUM(balance),0) AS balance,
          COALESCE(SUM(balance >= principal),0) AS done_cnt,
          COALESCE(SUM(CASE WHEN balance >= principal THEN principal ELSE 0 END),0) AS done_principal,
          COALESCE(SUM(balance < principal),0) AS open_cnt,
          COALESCE(SUM(CASE WHEN balance < principal THEN principal ELSE 0 END),0) AS open_principal,
          COALESCE(SUM(CASE WHEN balance < principal THEN principal - balance ELSE 0 END),0) AS open_pending
        FROM borrower_customers`);
      const collected = (await one('SELECT COALESCE(SUM(amount),0) AS s FROM borrower_collections')).s;
      const borrowerSum = {
        count: +r.cnt, principal: num(r.principal), due_collected: num(collected), balance: num(r.balance),
        pending: num(r.principal - r.balance),
        completed: { count: +r.done_cnt, principal: num(r.done_principal) },
        incomplete: { count: +r.open_cnt, principal: num(r.open_principal), pending: num(r.open_pending) },
      };
      const bp = await q('SELECT id, name, principal, balance, transaction_date, payment_type FROM borrower_customers WHERE is_active = 1 AND balance < principal');
      for (const row of bp) {
        const periods = borrowerDuePeriods(row.principal, row.payment_type, row.transaction_date, today);
        if (!periods.length) continue;
        const cs = await q('SELECT collection_date, amount FROM borrower_collections WHERE customer_id=? ORDER BY collection_date ASC, id ASC', [row.id]);
        const sched = reconcileDueSchedule(periods, cs.map(x => ({ date: x.collection_date, amount: Number(x.amount) })));
        const last = sched[sched.length - 1];
        if (last && last.status !== 'complete') pendingList.push({ module: 'Borrower', name: row.name, amount: num(row.principal - row.balance) });
      }

      // ---- Interest ----
      const res = await q(`SELECT ic.id, ic.name, ic.principal, ic.principal_balance, ic.rate_of_interest, ic.transaction_date, ic.total_interest_collected,
          (SELECT MAX(p.collection_date) FROM interest_principal_collections p WHERE p.customer_id = ic.id) AS last_principal_date
        FROM interest_customers ic`);
      const blank = () => ({ count: 0, principal: 0, principal_collected: 0, principal_balance: 0, interest_collected: 0, overdue_interest: 0 });
      const buckets = { completed: blank(), partial: blank(), not_started: blank(), all: blank() };
      for (const row of res) {
        const pr = +row.principal, bal = +row.principal_balance, intColl = +(row.total_interest_collected || 0);
        const prColl = Math.max(0, pr - bal);
        const endDate = (bal <= 0 && row.last_principal_date) ? row.last_principal_date : today;
        const months = fullMonthsBetween(row.transaction_date, endDate);
        const overdue = Math.max(0, months * pr * (+row.rate_of_interest / 100) - intColl);
        if (overdue > 0.01) pendingList.push({ module: 'Interest', name: row.name, amount: num(overdue) });
        const key = bal <= 0 ? 'completed' : (bal < pr ? 'partial' : 'not_started');
        names.interest.push({ name: row.name, principal: num(pr), pr_paid: num(prColl), out: num(bal), int_paid: num(intColl), overdue: num(overdue), cat: key });
        for (const k of [key, 'all']) {
          const b = buckets[k];
          b.count++; b.principal += pr; b.principal_collected += prColl; b.principal_balance += bal;
          b.interest_collected += intColl; b.overdue_interest += overdue;
        }
      }
      const roundB = c => { const o = {}; for (const k in c) o[k] = k === 'count' ? c[k] : num(c[k]); return o; };
      for (const k in buckets) buckets[k] = roundB(buckets[k]);
      const tot = buckets.all;
      const interestSum = {
        count: tot.count, principal: tot.principal,
        interest_collected: num((await one('SELECT COALESCE(SUM(amount),0) AS s FROM interest_collections')).s),
        overdue_interest: tot.overdue_interest, principal_balance: tot.principal_balance,
        principal_collected: num((await one('SELECT COALESCE(SUM(amount),0) AS s FROM interest_principal_collections')).s),
        categories: { completed: buckets.completed, partial: buckets.partial, not_started: buckets.not_started },
      };

      // ---- Rent (current month) ----
      const month = currentMonth();
      const rr = await q(`SELECT rc.name, rc.rent_amount, rc.is_active,
        (SELECT MAX(rp.payment_date) FROM rent_payments rp WHERE rp.customer_id = rc.id) AS last_date FROM rent_customers rc`);
      const rentSum = { count: 0, active_count: 0, monthly_total: 0, paid_count: 0, pending_count: 0, pending: 0 };
      for (const row of rr) {
        rentSum.count++;
        if (!+row.is_active) continue;
        rentSum.active_count++;
        rentSum.monthly_total += +row.rent_amount;
        const isPaid = !!(row.last_date && row.last_date.slice(0, 7) === month);
        names.rent.push({ name: row.name, rent: num(row.rent_amount), paid: isPaid });
        if (isPaid) rentSum.paid_count++;
        else { rentSum.pending_count++; rentSum.pending += +row.rent_amount; pendingList.push({ module: 'Rent', name: row.name, amount: num(row.rent_amount) }); }
      }
      rentSum.collected = num((await one(`SELECT COALESCE(SUM(amount),0) AS s FROM rent_payments WHERE substr(payment_date,1,7) = ?`, [month])).s);
      rentSum.collected_all_time = num((await one('SELECT COALESCE(SUM(amount),0) AS s FROM rent_payments')).s);
      rentSum.monthly_total = num(rentSum.monthly_total);
      rentSum.pending = num(rentSum.pending);
      rentSum.month = month;

      // ---- MOI ----
      const m = await one('SELECT COUNT(*) AS cnt, COALESCE(SUM(income),0) AS income, COALESCE(SUM(expenditure),0) AS expenditure FROM moi_records');
      const moiSum = { count: +m.cnt, income: num(m.income), expenditure: num(m.expenditure), net: num(m.income - m.expenditure) };

      for (const x of await q('SELECT name, principal, balance FROM borrower_customers ORDER BY name'))
        names.borrower.push({ name: x.name, principal: num(x.principal), paid: num(x.balance), out: num(Math.max(0, x.principal - x.balance)) });
      for (const x of await q('SELECT name_tamil AS name, income, expenditure FROM moi_records ORDER BY name_tamil'))
        names.moi.push({ name: x.name, income: num(x.income), expenditure: num(x.expenditure) });

      const now = new Date();
      const generated = `${todayStr()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      return { generated, names, borrower: borrowerSum, interest: interestSum, rent: rentSum, moi: moiSum, pending_list: pendingList };
    },
  };

  const routes = {
    'borrower_api.php': borrower, 'interest_api.php': interest, 'rent_api.php': rent,
    'moi_api.php': moi, 'reports_api.php': reports,
  };

  return {
    // call('borrower_api.php?action=list&q=abc', {extra form fields})
    async call(url, data = {}) {
      const [file, qs = ''] = String(url).split('?');
      const params = Object.fromEntries(new URLSearchParams(qs).entries());
      const all = { ...params, ...data };
      const mod = routes[file];
      const fn = mod && mod[all.action];
      if (!fn) return { error: 'Unknown action' };
      return fn(all);
    },
  };
}
