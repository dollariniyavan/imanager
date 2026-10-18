// ==========================================================
// Backup / restore
//  - export: one JSON file with every table (login/settings are not part of it)
//  - restore: accepts that JSON file AND the MySQL dumps (.sql / .sql.gz) produced by the old PHP
//    web version (backup.php / backup_mail.php), so existing data moves straight into the phone.
// ==========================================================
import { TABLES, TABLE_ORDER } from './schema.js';

export async function exportAll(adapter) {
  const tables = {};
  for (const t of TABLE_ORDER) tables[t] = await adapter.query(`SELECT * FROM ${t} ORDER BY id`);
  return { app: 'loan-manager', format: 1, exported_at: new Date().toISOString(), tables };
}

// ---------- MySQL dump parser (INSERT statements only; CREATE/DROP/SET are skipped) ----------
export function parseSqlDump(text) {
  const out = {};
  const n = text.length;
  let i = 0;

  const skipWs = () => { while (i < n && /\s/.test(text[i])) i++; };
  const skipToStmtEnd = () => {            // quote/comment aware skip to the next top-level ';'
    while (i < n) {
      const c = text[i];
      if (c === "'" || c === '"' || c === '`') { i = endOfQuoted(i); continue; }
      if (c === '-' && text[i + 1] === '-' ) { while (i < n && text[i] !== '\n') i++; continue; }
      if (c === '#') { while (i < n && text[i] !== '\n') i++; continue; }
      if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      i++;
      if (c === ';') return;
    }
  };
  const endOfQuoted = (start) => {         // index just after the closing quote
    const q = text[start]; let j = start + 1;
    while (j < n) {
      const c = text[j];
      if (c === '\\' && q !== '`') { j += 2; continue; }
      if (c === q) { if (text[j + 1] === q) { j += 2; continue; } return j + 1; }
      j++;
    }
    return n;
  };
  const ESC = { '0': '\0', n: '\n', r: '\r', t: '\t', b: '\b', Z: '\x1a' };
  const readString = () => {
    const q = text[i]; i++;
    let s = '';
    while (i < n) {
      const c = text[i];
      if (c === '\\') { const d = text[i + 1]; s += (d in ESC) ? ESC[d] : (d === '%' || d === '_' ? '\\' + d : d); i += 2; continue; }
      if (c === q) { if (text[i + 1] === q) { s += q; i += 2; continue; } i++; return s; }
      s += c; i++;
    }
    return s;
  };
  const readValue = () => {
    skipWs();
    const c = text[i];
    if (c === "'" || c === '"') return readString();
    let j = i;
    while (j < n && text[j] !== ',' && text[j] !== ')') j++;
    const tok = text.slice(i, j).trim(); i = j;
    if (/^null$/i.test(tok)) return null;
    return tok;
  };
  const readIdentList = (s) => s.split(',').map(x => x.trim().replace(/^`|`$/g, ''));

  const head = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?([A-Za-z0-9_]+)`?\s*(\([^)]*\))?\s*VALUES\s*/iy;
  while (i < n) {
    skipWs();
    if (i >= n) break;
    // comments between statements
    if (text.startsWith('--', i) || text[i] === '#') { while (i < n && text[i] !== '\n') i++; continue; }
    if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    head.lastIndex = i;
    const m = head.exec(text);
    if (!m) { skipToStmtEnd(); continue; }
    i = head.lastIndex;
    const table = m[1];
    const cols = m[2] ? readIdentList(m[2].slice(1, -1)) : (TABLES[table] ? TABLES[table].cols : null);
    if (!cols) { skipToStmtEnd(); continue; }
    const rows = out[table] || (out[table] = []);
    for (;;) {                                  // (v,v,...) [, (v,v,...)]* ;
      skipWs();
      if (text[i] !== '(') break;
      i++;
      const row = {};
      for (let k = 0; ; k++) {
        row[cols[k]] = readValue();
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ')') { i++; break; }
        throw new Error('Unexpected character in SQL dump near position ' + i);
      }
      rows.push(row);
      skipWs();
      if (text[i] === ',') { i++; continue; }
      break;
    }
    skipToStmtEnd();
  }
  return out;
}

export function parseBackupText(text) {
  const t = text.replace(/^\uFEFF/, '');
  if (t.trimStart().startsWith('{')) {
    const o = JSON.parse(t);
    if (!o || typeof o.tables !== 'object') throw new Error('This JSON file is not a Loan Manager backup.');
    return o.tables;
  }
  return parseSqlDump(t);
}

// Build the statements that replace the contents of every table present in the backup.
export function buildRestoreStatements(tables) {
  const present = TABLE_ORDER.filter(t => Array.isArray(tables[t]));
  if (!present.length) throw new Error('No Loan Manager tables were found in this file.');
  const stmts = [];
  [...present].reverse().forEach(t => stmts.push({ statement: `DELETE FROM ${t}`, values: [] }));
  let count = 0;
  for (const t of present) {
    const meta = TABLES[t];
    for (const row of tables[t]) {
      const cols = [], vals = [];
      for (const c of meta.cols) {
        if (!(c in row)) continue;
        let v = row[c];
        if (v === undefined) continue;
        if (v !== null && meta.dates.includes(c) && /^0000-00-00/.test(String(v))) v = null;   // MySQL zero-date
        if (v === null && meta.notNull.includes(c)) continue;                                  // let the column default apply
        cols.push(c); vals.push(v);
      }
      stmts.push({ statement: `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, values: vals });
      count++;
    }
  }
  return { statements: stmts, tables: present, rows: count };
}

export async function restoreTables(adapter, tables) {
  const plan = buildRestoreStatements(tables);
  await adapter.batch(plan.statements);          // adapter.batch runs inside one transaction
  return plan;
}
