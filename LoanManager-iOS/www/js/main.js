// ==========================================================
// Start-up module (runs inside the iOS WKWebView)
//   1. Lock screen: fingerprint / phone screen-lock before anything loads
//   2. Local SQLite database (kept by the native side, in the app's private storage)
//   3. window.LocalAPI    - the former PHP endpoints (store.js)
//   4. window.NativeBridge - contacts, share, print, voice, WhatsApp/SMS links, backup/restore
// ==========================================================
import { SCHEMA } from './schema.js';
import { createApi } from './store.js';
import { exportAll, parseBackupText, restoreTables } from './backup.js';

const A = window.Android;                       // injected by MainActivity.kt
const $ = id => document.getElementById(id);

// ---------------------------------------------------------- async calls into Kotlin
const pending = {};
let seq = 0;
window.__nativeCb = (id, payload) => { const f = pending[id]; if (f) { delete pending[id]; f(payload); } };
const callAsync = start => new Promise(resolve => { const id = 'c' + (++seq); pending[id] = resolve; start(id); });
const unwrap = s => { const o = JSON.parse(s); if (o && o.error) throw new Error(o.error === 'locked' ? 'The app is locked.' : o.error); return o; };

// ---------------------------------------------------------- SQLite adapter (same shape the tests use)
const adapter = {
  async query(sql, params = []) { return unwrap(await A.dbQuery(sql, JSON.stringify(params))); },
  async run(sql, params = []) { return unwrap(await A.dbRun(sql, JSON.stringify(params))); },
  async batch(set) { if (set.length) unwrap(await A.dbBatch(JSON.stringify(set))); },   // one transaction
};
const getSetting = async k => (await adapter.query('SELECT v FROM app_settings WHERE k=?', [k]))[0]?.v ?? null;
const setSetting = (k, v) => adapter.run('INSERT INTO app_settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [k, String(v)]);

// ---------------------------------------------------------- bridge used by common.js / app.js
const bridge = {
  isNative: !!A,

  async pickContact() {
    const r = await callAsync(id => A.pickContact(id));
    return (r && r.name !== undefined) ? r : null;                // cancelled -> null
  },
  async voice() { const r = await callAsync(id => A.voiceSearch(id)); return (r && r.text) || ''; },
  async openUrl(url) { return A.openUrl(url); },

  async shareFile(filename, text, title) {
    const r = await callAsync(id => A.shareFile(filename, text, title || filename, id));
    if (r && r.error) throw new Error(r.error);
  },
  // Native print dialog (choose a printer or "Save as PDF")
  printHtml(html, jobName) { A.printHtml(html, jobName || 'Report'); },

  async backupStatus() { return { last: await getSetting('last_backup') }; },

  async exportBackup() {
    const dump = await exportAll(adapter);
    const p = n => String(n).padStart(2, '0'), d = new Date();
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
    await bridge.shareFile(`loan_backup_${stamp}.json`, JSON.stringify(dump), 'Loan Manager backup');
    await setSetting('last_backup', new Date().toISOString());
    return { success: true, message: 'Backup file created. Save it to Drive / send it to yourself.' };
  },

  // file: from <input type=file>; accepts .json (this app) and .sql / .sql.gz (old PHP version)
  async restoreFromFile(file) {
    let text;
    if (/\.gz$/i.test(file.name)) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Cannot open .gz here. Unzip it first and choose the .sql file.');
      text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else {
      text = await file.text();
    }
    const plan = await restoreTables(adapter, parseBackupText(text));
    return { success: true, message: `Restored ${plan.rows} records (${plan.tables.length} tables).` };
  },

  lock() { lockApp(); },
};
window.NativeBridge = bridge;

// ---------------------------------------------------------- lock screen
let unlocked = false, booted = false, authBusy = false;

function showLock(msg, isError) {
  document.body.classList.add('locked');
  const m = $('lockMsg');
  if (m) { m.textContent = msg || ''; m.className = 'lock-msg' + (isError ? ' err' : ''); m.hidden = !msg; }
}
const hideLock = () => document.body.classList.remove('locked');

async function authenticate() {
  if (authBusy || unlocked) return;
  authBusy = true;
  const btn = $('lockBtn'); if (btn) btn.disabled = true;
  try {
    const state = await A.canAuthenticate();
    if (state === 'none_enrolled') {
      showLock('No passcode is set on this iPhone. Set one in Settings → Face ID & Passcode, then tap Unlock.', true);
      return;
    }
    if (state !== 'ok') {
      showLock('Face ID / passcode is not available right now. Make sure a passcode is set, then tap Unlock.', true);
      return;
    }
    const res = await callAsync(id => A.authenticate(id));
    if (!res || !res.ok) {
      const code = res && res.code;
      if (code === 10 || code === 13 || code === 5) showLock('Locked. Tap Unlock to continue.');   // cancelled
      else showLock((res && res.message) || 'Could not unlock.', true);
      return;
    }
    unwrap(await A.dbInit(JSON.stringify(SCHEMA)));
    window.LocalAPI = createApi(adapter);
    unlocked = true;
    hideLock();
    if (!booted) { booted = true; window.appBoot && window.appBoot(); }
    else if (window.appResume) window.appResume();
  } catch (e) {
    showLock((e && e.message) ? e.message : 'Could not unlock.', true);
  } finally {
    authBusy = false;
    if (btn) btn.disabled = false;
  }
}

function lockApp() {
  unlocked = false;
  try { A.setLocked(); } catch (e) { /* ignore */ }
  document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  showLock('Locked. Tap Unlock to continue.');
  authenticate();
}
window.relock = lockApp;                 // called by MainActivity after the app was away for a while

function start() {
  const btn = $('lockBtn');
  if (btn) btn.addEventListener('click', authenticate);
  if (!A) { showLock('Open this page inside the Loan Manager iOS app.', true); return; }
  showLock('');
  authenticate();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !unlocked) authenticate(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
