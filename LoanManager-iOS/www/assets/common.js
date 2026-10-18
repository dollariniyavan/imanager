// ==========================================================
// COMMON HELPERS
//  - AJAX wrappers (bounce to login on 401)
//  - +91 mobile handling, phone-contact picker
//  - WhatsApp / SMS "Send" dialog (replaces the old Print buttons)
//  - Active / Inactive tabs, voice search, sort, print
// ==========================================================

function debounce(fn, delay) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), delay);
    };
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// HTML-escape anything that came from the database / the phone contacts
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
// "Rs. 12,345.00" (plain "Rs." so SMS stays in the cheaper 160-character encoding)
function inr(v) {
    return 'Rs. ' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Local (not UTC) yyyy-mm-dd - the old toISOString() gave "yesterday" in India before 5:30 AM
function todayStr() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

let _toastTimer;
function toast(msg, kind) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.className = 'toast' + (kind === 'warn' ? ' warn' : '');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4500);
}

// ----------------------------------------------------------
// "AJAX" - now answered by the local SQLite database on the phone (window.LocalAPI, see src/store.js).
// Same URLs and JSON shapes as the old PHP endpoints.
// ----------------------------------------------------------
async function apiPost(url, dataObj) { return window.LocalAPI.call(url, dataObj || {}); }
async function apiGet(url) { return window.LocalAPI.call(url, {}); }

// Open WhatsApp / SMS / any link in the other app
function openExternal(url) {
    if (window.NativeBridge && window.NativeBridge.openUrl) { Promise.resolve(window.NativeBridge.openUrl(url)).then(ok => { if (!ok) toast('Could not open the app for this link.', 'warn'); }); return; }
    window.open(url, '_blank');
}

// ----------------------------------------------------------
// Print (MOI, Reports, Summary): opens the Android print dialog - pick a printer or "Save as PDF".
// ----------------------------------------------------------
async function printSectionHtml(html) {
    try {
        let css = '';
        try { css = await (await fetch('assets/style.css')).text(); } catch (e) { /* styling is optional */ }
        const doc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>${css}</style></head><body style="padding:12px;background:#fff;color:#111;font-family:'Noto Sans Tamil',Arial,sans-serif">${html}</body></html>`;
        window.NativeBridge.printHtml(doc, 'Report ' + todayStr());
    } catch (e) {
        toast('Could not open the print dialog: ' + (e && e.message ? e.message : e), 'warn');
    }
}

// ----------------------------------------------------------
// +91 mobile handling
// ----------------------------------------------------------
// "+91 98765 43210" / "09876543210" / "91-9876543210"  ->  "9876543210"
function normMobile(raw) {
    let d = String(raw ?? '').replace(/\D+/g, '').replace(/^0+/, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length > 10) d = d.slice(-10);
    return d;
}

// ----------------------------------------------------------
// Phone contacts (native Android contact picker through the app bridge)
// ----------------------------------------------------------
// Must be called straight from a click. Resolves to {name, mobiles:[10-digit,...]} or null.
async function pickContact() {
    try {
        const c = await window.NativeBridge.pickContact();
        if (!c) return null;
        const mobiles = [...new Set((c.tel || []).map(normMobile).filter(m => m.length === 10))];
        if (!mobiles.length) { toast('That contact has no valid mobile number.', 'warn'); return null; }
        return { name: (c.name || '').trim(), mobiles };
    } catch (e) {
        return null; // cancelled
    }
}

// Small dialog to choose one number when a contact has several
function chooseNumber(name, mobiles) {
    return new Promise(resolve => {
        let m = document.getElementById('numModal');
        if (m) m.remove();
        m = document.createElement('div');
        m.className = 'modal-overlay active';
        m.id = 'numModal';
        m.innerHTML = `<div class="modal-box" style="max-width:380px">
            <button class="modal-close" type="button">&times;</button>
            <h2>Choose number</h2>
            <p class="hint">${esc(name || 'This contact')} has ${mobiles.length} numbers:</p>
            ${mobiles.map(n => `<button type="button" class="num-choice" data-n="${n}">+91 ${n.slice(0, 5)} ${n.slice(5)}</button>`).join('')}
        </div>`;
        document.body.appendChild(m);
        const done = v => { m.remove(); resolve(v); };
        m.querySelector('.modal-close').onclick = () => done(null);
        m.querySelectorAll('.num-choice').forEach(b => b.onclick = () => done(b.dataset.n));
    });
}

// Fill the name + mobile fields of an Add form from a phone contact.
async function contactToForm(formId) {
    const c = await pickContact();
    if (!c) return false;
    let mobile = c.mobiles[0];
    if (c.mobiles.length > 1) { mobile = await chooseNumber(c.name, c.mobiles); if (!mobile) return false; }
    const f = document.getElementById(formId);
    f.elements.namedItem('name').value = c.name;
    f.elements.namedItem('mobile').value = mobile;
    return true;
}

// Search box filter using a phone contact (matches the contact's number(s)).
async function contactFilter(p) {
    const c = await pickContact();
    if (!c) return;
    document.getElementById(p + '_searchBox').value = c.mobiles.join(',');
    document.getElementById(p + '_chipText').textContent = `${c.name || 'Contact'} · ${c.mobiles.join(', ')}`;
    document.getElementById(p + '_chip').hidden = false;
    window[p + '_loadTable']();
}
function clearContactFilter(p) {
    document.getElementById(p + '_searchBox').value = '';
    document.getElementById(p + '_chip').hidden = true;
    window[p + '_loadTable']();
}

// ----------------------------------------------------------
// WhatsApp / SMS "Send" dialog  (replaces every Print button except MOI + Reports)
//
// A web page cannot ask WhatsApp whether a number is registered, so the dialog offers
// both channels; ticking "not on WhatsApp" is remembered on this device and from then on
// only SMS is offered for that number.  Numbers are always sent as +91XXXXXXXXXX.
// ----------------------------------------------------------
const _NOWA_KEY = 'noWhatsAppNumbers';
function _getNoWa() { try { return JSON.parse(localStorage.getItem(_NOWA_KEY) || '[]'); } catch (e) { return []; } }
function _setNoWa(num, flag) {
    try {
        const a = _getNoWa().filter(x => x !== num);
        if (flag) a.push(num);
        localStorage.setItem(_NOWA_KEY, JSON.stringify(a));
    } catch (e) { /* private mode - ignore */ }
}

let _sendNum = '';
function _ensureSendModal() {
    if (document.getElementById('sendModal')) return;
    const m = document.createElement('div');
    m.className = 'modal-overlay';
    m.id = 'sendModal';
    m.innerHTML = `<div class="modal-box">
        <button class="modal-close" type="button" onclick="closeModal('sendModal')">&times;</button>
        <h2 id="sendTitle">📤 Send details</h2>
        <p class="send-to" id="sendTo"></p>
        <textarea id="sendText"></textarea>
        <label class="check-row"><input type="checkbox" id="sendNoWa"> This number is not on WhatsApp (send by SMS)</label>
        <p class="hint" id="sendHint"></p>
        <div class="modal-btn-row">
            <button type="button" class="btn btn-wa" id="sendWaBtn">💬 WhatsApp</button>
            <button type="button" class="btn btn-sms" id="sendSmsBtn">✉️ SMS</button>
            <button type="button" class="btn btn-cancel" onclick="closeModal('sendModal')">Close</button>
        </div>
    </div>`;
    document.body.appendChild(m);
    document.getElementById('sendNoWa').addEventListener('change', e => {
        _setNoWa(_sendNum, e.target.checked);
        _applySendState();
    });
    document.getElementById('sendWaBtn').addEventListener('click', () => {
        const text = document.getElementById('sendText').value;
        openExternal(`https://wa.me/91${_sendNum}?text=${encodeURIComponent(text)}`);
    });
    document.getElementById('sendSmsBtn').addEventListener('click', () => {
        const text = document.getElementById('sendText').value;
        openExternal(`sms:+91${_sendNum}?body=${encodeURIComponent(text)}`);
    });
}
function _applySendState() {
    const noWa = document.getElementById('sendNoWa').checked;
    document.getElementById('sendWaBtn').disabled = noWa;
    document.getElementById('sendHint').textContent = noWa
        ? 'WhatsApp is switched off for this number - the details will go as a normal SMS.'
        : 'Not on WhatsApp? Tick the box above and use SMS (remembered for next time).';
}

function openSend(mobile, text, title) {
    const num = normMobile(mobile);
    if (num.length !== 10) { alert('This record has no valid 10-digit mobile number.'); return; }
    _ensureSendModal();
    _sendNum = num;
    document.getElementById('sendTitle').textContent = '📤 ' + (title || 'Send details');
    document.getElementById('sendTo').innerHTML = `To: <b>+91 ${num.slice(0, 5)} ${num.slice(5)}</b>`;
    document.getElementById('sendText').value = text;
    document.getElementById('sendNoWa').checked = _getNoWa().includes(num);
    _applySendState();
    openModal('sendModal');
}

// ----------------------------------------------------------
// Active / Inactive tabs (Interest, Borrower, Rent)
// ----------------------------------------------------------
function segInit(prefix, onChange) {
    const seg = document.getElementById(prefix + '_seg');
    seg.addEventListener('click', e => {
        const b = e.target.closest('button[data-s]');
        if (!b) return;
        seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        onChange(b.dataset.s);
    });
}
function segCounts(prefix, rows) {
    const a = rows.filter(r => +r.is_active === 1).length;
    document.getElementById(prefix + '_cnt_active').textContent = a;
    document.getElementById(prefix + '_cnt_inactive').textContent = rows.length - a;
    document.getElementById(prefix + '_cnt_all').textContent = rows.length;
}
function segFilter(rows, s) {
    return s === 'all' ? rows : rows.filter(r => (+r.is_active === 1) === (s === 'active'));
}
async function setActive(api, id, makeActive) {
    const res = await apiPost(api + '?action=set_active', { id, active: makeActive ? 1 : 0 });
    if (!res.success) alert(res.message || 'Failed');
    return res.success;
}
const statusBadge = r => +r.is_active === 1
    ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Inactive</span>';

// ----------------------------------------------------------
// Voice search (Tamil) using Web Speech API.
// ----------------------------------------------------------
function setupVoiceSearch(micBtnId, inputId) {
    const micBtn = document.getElementById(micBtnId);
    const input = document.getElementById(inputId);
    if (!micBtn || !input) return;
    micBtn.addEventListener('click', async () => {
        if (!window.NativeBridge || !window.NativeBridge.voice) return;
        micBtn.classList.add('listening');
        try {
            const text = await window.NativeBridge.voice();   // Android speech dialog, Tamil (India)
            if (text) { input.value = text; input.dispatchEvent(new Event('input')); }
        } catch (e) { /* cancelled */ }
        micBtn.classList.remove('listening');
    });
}

// ----------------------------------------------------------
// Column sort helper for the MOI table (client-side click-to-sort)
// ----------------------------------------------------------
function sortTableByColumn(table, colIndex, asc) {
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.sort((a, b) => {
        const av = a.children[colIndex].innerText.trim().toLowerCase();
        const bv = b.children[colIndex].innerText.trim().toLowerCase();
        const an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
        return asc ? av.localeCompare(bv, 'ta') : bv.localeCompare(av, 'ta');
    });
    rows.forEach(r => tbody.appendChild(r));
}

// ----------------------------------------------------------
// Mobile formatting (+91) and calling
// ----------------------------------------------------------
function fmtMobile(raw) {
    const n = normMobile(raw);
    if (n.length === 10) {
        return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
    }
    return String(raw ?? '');
}

function makeCall(raw) {
    const n = normMobile(raw);
    if (n.length === 10) {
        const telUrl = `tel:+91${n}`;
        if (window.Android && window.Android.openUrl) {
            window.Android.openUrl(telUrl);
        } else {
            window.location.href = telUrl;
        }
    } else {
        alert('Invalid mobile number.');
    }
}
