// ==========================================================
// APP LOGIC  (navigation, Borrower, Interest, Rent, MOI,
// Reports, Summary graphs, Backup dialog, Change password)
// Depends on common.js + charts.js
// ==========================================================
const $ = id => document.getElementById(id);
const PAYMENT_TYPES = { '100days': '100 Days', '10weeks': '10 Weeks', '20weeks': '20 Weeks', 'monthly': 'Monthly' };
const INACTIVE_TIP = 'Inactive - set the record to Active to accept payments';

// ================= PAGE NAVIGATION =================
function toggleNavigationDrawer() {
    $('navDrawer').classList.toggle('active');
    $('drawerOverlay').classList.toggle('active');
}
function closeNavigationDrawer() {
    $('navDrawer').classList.remove('active');
    $('drawerOverlay').classList.remove('active');
}

function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pEl = $('page-' + name);
    if (pEl) pEl.classList.add('active');

    document.querySelectorAll('.global-nav .nav-item, .drawer-item').forEach(b => b.classList.remove('active'));
    const navBtn = document.querySelector(`.global-nav .nav-item[data-page="${name}"]`) ||
                   document.querySelector(`.drawer-item[data-page="${name}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (['reports', 'summary'].includes(name)) {
        const menuBtn = $('menuNavBtn');
        if (menuBtn) menuBtn.classList.add('active');
    } else {
        const menuBtn = $('menuNavBtn');
        if (menuBtn) menuBtn.classList.remove('active');
    }

    window.scrollTo(0, 0);
    if (name === 'summary') sum_load();
}

// ================= BACKUP / RESTORE (local) =================
function openBackupModal() {
    openModal('dbModal');
    loadBackupStatus();
}
function loadBackupStatus() {
    window.NativeBridge.backupStatus().then(d => {
        const el = $('dbBackupInfo');
        if (!d.last) { el.innerHTML = '⚠ <b>No backup has been taken yet.</b> If the phone is lost or reset, the data is lost.'; return; }
        const days = Math.floor((Date.now() - new Date(d.last).getTime()) / 86400000);
        el.innerHTML = `Last backup: <b>${esc(new Date(d.last).toLocaleString('en-IN'))}</b>` +
            (days >= 7 ? ` — <span style="color:#e63946;font-weight:700">${days} days ago, please back up again</span>` : '');
    }).catch(() => {});
}
function dbBackup() {
    const btn = $('dbBackupBtn'), st = $('dbBackupResult');
    btn.disabled = true; st.style.color = '#888'; st.textContent = 'Creating backup...';
    window.NativeBridge.exportBackup().then(res => {
        st.textContent = res.message; st.style.color = '#2a9d8f';
    }).catch(e => {
        // closing the share sheet without choosing an app is not an error worth showing
        const msg = String((e && e.message) || e);
        st.textContent = /cancel/i.test(msg) ? '' : 'Backup failed: ' + msg;
        st.style.color = '#e63946';
    }).finally(() => { btn.disabled = false; loadBackupStatus(); });
}
function dbRestore() {
    const fileInput = $('dbRestoreFile');
    const statusEl = $('dbRestoreStatus');
    if (!fileInput.files.length) {
        statusEl.textContent = 'Please choose a backup file first.';
        statusEl.style.color = '#e63946';
        return;
    }
    if (!confirm('This will replace the existing data in the tables found in the file. Continue?')) return;
    statusEl.textContent = 'Restoring... please wait.';
    statusEl.style.color = '#888';
    window.NativeBridge.restoreFromFile(fileInput.files[0]).then(res => {
        statusEl.textContent = res.message;
        statusEl.style.color = '#2a9d8f';
        fileInput.value = '';
        loadAllTables();
        if ($('page-summary').classList.contains('active')) sum_load();
    }).catch(e => {
        statusEl.textContent = 'Restore failed: ' + ((e && e.message) || e);
        statusEl.style.color = '#e63946';
    });
}

// ================= BORROWER MODULE =================
let bor_rows = [], bor_status = 'active', bor_currentCustomer = null, bor_view = null;

function bor_loadTable() {
    const q = $('bor_searchBox').value;
    return apiGet(`borrower_api.php?action=list&q=${encodeURIComponent(q)}`).then(d => {
        bor_rows = d.rows;
        bor_render();
    });
}

function bor_render() {
    segCounts('bor', bor_rows);
    const rows = segFilter(bor_rows, bor_status);
    const body = $('bor_tableBody');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="8">No records found.</td></tr>'; return; }
    body.innerHTML = rows.map(r => {
        const act = +r.is_active === 1;
        const payOff = !act || parseFloat(r.balance) >= parseFloat(r.principal);
        return `<tr class="${act ? '' : 'row-inactive'}">
            <td data-label="Name">${esc(r.name)}</td>
            <td data-label="Mobile"><span onclick="makeCall('${esc(r.mobile)}')" style="color:var(--heading);cursor:pointer;text-decoration:underline;font-weight:600;" title="Call ${esc(r.mobile)}">${esc(fmtMobile(r.mobile))}</span></td>
            <td data-label="Principal">${esc(r.principal)}</td>
            <td data-label="Paid">${esc(r.balance)}</td>
            <td data-label="Due Count">${esc(r.due_count)}</td>
            <td data-label="Day Count">${esc(r.day_count)}</td>
            <td data-label="Status">${statusBadge(r)}</td>
            <td class="actions">
                <button class="btn btn-view" onclick="bor_viewCustomer(${r.id})">View</button>
                <button class="btn btn-pay" ${payOff ? 'disabled' : ''} ${act ? '' : `title="${INACTIVE_TIP}"`} onclick="bor_viewCustomer(${r.id}, true)">Pay</button>
                <button class="btn btn-send" onclick="bor_sendRow(${r.id})">📤 Send</button>
                <button class="btn btn-toggle" onclick="bor_toggle(${r.id}, ${act ? 0 : 1})">${act ? 'Set Inactive' : 'Set Active'}</button>
            </td></tr>`;
    }).join('');
}

// ---- messages sent by WhatsApp / SMS ----
function bor_msgAccount(c) {
    const pending = parseFloat(c.principal) - parseFloat(c.balance);
    return ['Installment', '',
        `Name: ${c.name}`,
        `Principal: ${inr(c.principal)}`,
        `Collected: ${inr(c.balance)}`,
        `Pending: ${inr(pending)}`,
        `Due Count: ${c.due_count}`, `Day Count: ${c.day_count}`,
        `Schedule: ${PAYMENT_TYPES[c.payment_type] || c.payment_type}`,
        `Date: ${c.transaction_date}`,
        `Status: ${+c.is_active === 1 ? 'Active' : 'Inactive'}`].join('\n');
}
function bor_msgHistory(c, schedule) {
    return ['Transaction History', `Name: ${c.name}`, '',
        ...(schedule.length ? schedule.map(r => `${r.due_date}  Due ${inr(r.due_amount)}  Collected ${inr(r.collected)}  (${r.status})`) : ['No due dates yet']),
        '', `Total Collected: ${inr(c.balance)}`, `Pending: ${inr(parseFloat(c.principal) - parseFloat(c.balance))}`].join('\n');
}
function bor_msgReceipt(c, amount, date, status) {
    const collected = Math.min(parseFloat(c.principal), parseFloat(c.balance) + parseFloat(amount));
    return ['Due Payment Receipt', '',
        `Name: ${c.name}`, `Amount Paid: ${inr(amount)}`, `Date: ${date}`,
        `Status: ${status || ''}`,
        `Total Collected: ${inr(collected)}`,
        `Pending: ${inr(parseFloat(c.principal) - collected)}`, '', 'Thank you.'].join('\n');
}

function bor_sendRow(id) {
    const c = bor_rows.find(r => r.id == id);
    if (c) openSend(c.mobile, bor_msgAccount(c), 'Send installment details');
}
async function bor_toggle(id, makeActive) {
    if (await setActive('borrower_api.php', id, makeActive)) bor_loadTable();
}

// ---- add ----
async function bor_openAdd() {
    const f = $('bor_addForm'); f.reset();
    f.elements.namedItem('transaction_date').value = todayStr();
    await contactToForm('bor_addForm'); // asks for a phone contact first (name + mobile)
    openModal('bor_addModal');
}
function bor_submitAdd(andSend) {
    const f = $('bor_addForm');
    const data = Object.fromEntries(new FormData(f).entries());
    apiPost('borrower_api.php?action=add', data).then(res => {
        if (!res.success) { alert(res.message || 'Failed to save.'); return; }
        closeModal('bor_addModal'); f.reset(); bor_loadTable();
        if (andSend) openSend(res.mobile, bor_msgAccount({
            name: data.name, principal: data.principal, balance: 0, due_count: 0, day_count: 0,
            payment_type: data.payment_type, transaction_date: data.transaction_date, is_active: 1 }), 'Send installment details');
    });
}

// ---- view / pay ----
function bor_viewCustomer(id, goToPay) {
    apiGet('borrower_api.php?action=view&id=' + id).then(d => {
        if (!d.success) { alert('Not found'); return; }
        bor_view = d;
        bor_currentCustomer = d.customer;
        const c = d.customer;
        $('bor_viewCustomerBox').innerHTML = `
            <b>Name:</b> ${esc(c.name)} &nbsp; <b>Mobile:</b> <span onclick="makeCall('${esc(c.mobile)}')" style="color:var(--heading);cursor:pointer;text-decoration:underline;font-weight:600;" title="Call ${esc(c.mobile)}">${esc(fmtMobile(c.mobile))}</span><br>
            <b>Principal:</b> ${esc(c.principal)} &nbsp; <b>Collected:</b> ${esc(c.balance)}
            &nbsp; <b>Pending:</b> ${esc(c.pending_amount)}<br>
            <b>Status:</b> ${statusBadge(c)}`;

        $('bor_historyBox').innerHTML = d.schedule && d.schedule.length
            ? '<table><tr><th>Due Date</th><th>Due Amount</th><th>Collected</th><th>Status</th><th>Paid Date</th></tr>' +
              d.schedule.slice().reverse().map(r => `<tr><td>${esc(r.due_date)}</td><td>${esc(r.due_amount)}</td><td>${esc(r.collected)}</td>
                  <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(r.paid_date || '-')}</td></tr>`).join('') + '</table>'
            : 'No due dates yet';

        bor_showTab('bor_tabDetails', document.querySelector('#bor_viewModal .tab-buttons button'));
        if (goToPay) { closeModal('bor_viewModal'); bor_openPayModal(); }
        else openModal('bor_viewModal');
    });
}
function bor_showTab(tabId, btn) {
    document.querySelectorAll('#bor_viewModal .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#bor_viewModal .tab-buttons button').forEach(b => b.classList.remove('active'));
    $(tabId).classList.add('active');
    btn.classList.add('active');
}
function bor_sendCustomer() { if (bor_view) openSend(bor_view.customer.mobile, bor_msgAccount(bor_view.customer), 'Send installment details'); }
function bor_sendHistory() { if (bor_view) openSend(bor_view.customer.mobile, bor_msgHistory(bor_view.customer, bor_view.schedule || []), 'Send transaction history'); }

function bor_openPayModal() {
    const c = bor_currentCustomer;
    if (+c.is_active !== 1) { alert('This borrower is inactive. Set it to Active to accept payments.'); return; }
    $('bor_payCustomerId').value = c.id;
    $('bor_payCustomerBox').innerHTML = `
        <b>Name:</b> ${esc(c.name)} &nbsp; <b>Mobile:</b> ${esc(c.mobile)}<br>
        <b>Principal:</b> ${esc(c.principal)} &nbsp; <b>Collected:</b> ${esc(c.balance)}
        &nbsp; <b>Pending:</b> ${esc(c.pending_amount)}`;
    $('bor_payAmount').value = c.suggested_due;
    $('bor_payDate').value = todayStr();
    openModal('bor_payModal');
}
function bor_submitPay(andSend) {
    const id = $('bor_payCustomerId').value, amount = $('bor_payAmount').value, date = $('bor_payDate').value;
    const c = bor_currentCustomer;
    apiPost('borrower_api.php?action=pay_due', { id, amount, date }).then(res => {
        if (!res.success) { alert(res.message || 'Failed'); return; }
        closeModal('bor_payModal'); closeModal('bor_viewModal'); bor_loadTable();
        if (andSend) openSend(c.mobile, bor_msgReceipt(c, amount, date, res.status), 'Send payment receipt');
    });
}

// ================= INTEREST MODULE =================
let int_rows = [], int_status = 'active', int_currentCustomer = null, int_view = null;

function int_loadTable() {
    const q = $('int_searchBox').value;
    return apiGet(`interest_api.php?action=list&q=${encodeURIComponent(q)}`).then(d => {
        int_rows = d.rows;
        int_render();
    });
}

function int_render() {
    segCounts('int', int_rows);
    const rows = segFilter(int_rows, int_status);
    const body = $('int_tableBody');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="10">No records found.</td></tr>'; return; }
    body.innerHTML = rows.map(r => {
        const act = +r.is_active === 1;
        const payOff = !act || parseFloat(r.principal_balance) <= 0;
        return `<tr class="${act ? '' : 'row-inactive'}">
            <td data-label="Name">${esc(r.name)}</td>
            <td data-label="Mobile"><span onclick="makeCall('${esc(r.mobile)}')" style="color:var(--heading);cursor:pointer;text-decoration:underline;font-weight:600;" title="Call ${esc(r.mobile)}">${esc(fmtMobile(r.mobile))}</span></td>
            <td data-label="Principal">${esc(r.principal)}</td>
            <td data-label="Principal Balance">${esc(r.principal_balance)}</td>
            <td data-label="Rate %">${esc(r.rate_of_interest)}</td>
            <td data-label="Date">${esc(r.transaction_date)}</td>
            <td data-label="Payments">${esc(r.no_of_payments)}</td>
            <td data-label="Interest Coll.">${esc(r.total_interest_collected)}</td>
            <td data-label="Status">${statusBadge(r)}</td>
            <td class="actions">
                <button class="btn btn-view" onclick="int_viewCustomer(${r.id})">View</button>
                <button class="btn btn-pay" ${payOff ? 'disabled' : ''} ${act ? '' : `title="${INACTIVE_TIP}"`} onclick="int_quickPay(${r.id})">Pay</button>
                <button class="btn btn-send" onclick="int_sendRow(${r.id})">📤 Send</button>
                <button class="btn btn-toggle" onclick="int_toggle(${r.id}, ${act ? 0 : 1})">${act ? 'Set Inactive' : 'Set Active'}</button>
            </td></tr>`;
    }).join('');
}

// ---- messages ----
function int_msgAccount(c) {
    return ['Interest', '',
        `Name: ${c.name}`,
        `Principal: ${inr(c.principal)}`, `Principal Balance: ${inr(c.principal_balance)}`,
        `Rate of Interest: ${c.rate_of_interest}%`, `Date: ${c.transaction_date}`,
        `No. of Payments: ${c.no_of_payments}`, `Total Interest Collected: ${inr(c.total_interest_collected)}`,
        `Status: ${+c.is_active === 1 ? 'Active' : 'Inactive'}`].join('\n');
}
function int_msgSchedule(c, schedule, title) {
    return [title, `Name: ${c.name}`, '',
        ...(schedule.length ? schedule.map(r => `${r.due_date}  Due ${inr(r.due_amount)}  Collected ${inr(r.collected)}  (${r.status})`) : ['No due dates yet']),
        '', `Principal Balance: ${inr(c.principal_balance)}`].join('\n');
}
function int_msgHistory(c, rows, title) {
    return [title, `Name: ${c.name}`, '',
        ...(rows.length ? rows.map(r => `${r.collection_date}  ${inr(r.amount)}  (${r.status})`) : ['No records']),
        '', `Principal Balance: ${inr(c.principal_balance)}`].join('\n');
}
function int_msgReceipt(c, mode, amount, date, status) {
    const isInt = mode === 'interest';
    const balAfter = isInt ? parseFloat(c.principal_balance) : Math.max(0, parseFloat(c.principal_balance) - parseFloat(amount));
    return [(isInt ? 'Interest' : 'Principal') + ' Payment Receipt', '',
        `Name: ${c.name}`, `Amount Paid: ${inr(amount)}`, `Date: ${date}`, `Status: ${status || ''}`,
        `Principal Balance: ${inr(balAfter)}`, '', 'Thank you.'].join('\n');
}

function int_sendRow(id) {
    const c = int_rows.find(r => r.id == id);
    if (c) openSend(c.mobile, int_msgAccount(c), 'Send interest details');
}
async function int_toggle(id, makeActive) {
    if (await setActive('interest_api.php', id, makeActive)) int_loadTable();
}

// ---- add ----
async function int_openAdd() {
    const f = $('int_addForm'); f.reset();
    f.elements.namedItem('transaction_date').value = todayStr();
    await contactToForm('int_addForm');
    openModal('int_addModal');
}
function int_submitAdd(andSend) {
    const f = $('int_addForm');
    const data = Object.fromEntries(new FormData(f).entries());
    apiPost('interest_api.php?action=add', data).then(res => {
        if (!res.success) { alert(res.message || 'Failed to save.'); return; }
        closeModal('int_addModal'); f.reset(); int_loadTable();
        if (andSend) openSend(res.mobile, int_msgAccount({
            name: data.name, principal: data.principal, principal_balance: data.principal,
            rate_of_interest: data.rate_of_interest, transaction_date: data.transaction_date,
            no_of_payments: 0, total_interest_collected: 0, is_active: 1 }), 'Send interest details');
    });
}

// ---- view ----
function int_viewCustomer(id) {
    apiGet('interest_api.php?action=view&id=' + id).then(d => {
        if (!d.success) { alert('Not found'); return; }
        int_view = d;
        int_currentCustomer = d.customer;
        const c = d.customer;
        $('int_viewCustomerBox').innerHTML = `
            <b>Name:</b> ${esc(c.name)} &nbsp; <b>Mobile:</b> <span onclick="makeCall('${esc(c.mobile)}')" style="color:var(--heading);cursor:pointer;text-decoration:underline;font-weight:600;" title="Call ${esc(c.mobile)}">${esc(fmtMobile(c.mobile))}</span><br>
            <b>Rate of Interest:</b> ${esc(c.rate_of_interest)}% &nbsp; <b>Principal:</b> ${esc(c.principal)}<br>
            <b>Remaining Principal:</b> ${esc(c.principal_balance)} &nbsp; <b>Total Interest Collected:</b> ${esc(c.total_interest_collected)}<br>
            <b>Status:</b> ${statusBadge(c)}`;

        const hist = rows => rows.length
            ? '<table><tr><th>Date</th><th>Amount</th><th>Status</th></tr>' +
              rows.map(r => `<tr><td>${esc(r.collection_date)}</td><td>${esc(r.amount)}</td>
                  <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td></tr>`).join('') + '</table>'
            : 'No records';
        $('int_interestHistoryBox').innerHTML = d.interest_schedule && d.interest_schedule.length
            ? '<table><tr><th>Due Date</th><th>Due Amount</th><th>Collected</th><th>Status</th><th>Paid Date</th></tr>' +
              d.interest_schedule.slice().reverse().map(r => `<tr><td>${esc(r.due_date)}</td><td>${esc(r.due_amount)}</td><td>${esc(r.collected)}</td>
                  <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(r.paid_date || '-')}</td></tr>`).join('') + '</table>'
            : 'No due dates yet';
        $('int_principalHistoryBox').innerHTML = hist(d.principal_history);

        // Payments are only possible while the record is Active
        const act = +c.is_active === 1;
        document.querySelectorAll('#int_viewModal .pay-btn').forEach(b => {
            b.disabled = !act;
            b.title = act ? '' : INACTIVE_TIP;
        });

        int_showTab('int_tabDetails', document.querySelector('#int_viewModal .tab-buttons button'));
        openModal('int_viewModal');
    });
}
function int_showTab(tabId, btn) {
    document.querySelectorAll('#int_viewModal .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#int_viewModal .tab-buttons button').forEach(b => b.classList.remove('active'));
    $(tabId).classList.add('active');
    btn.classList.add('active');
}
function int_sendCustomer() { if (int_view) openSend(int_view.customer.mobile, int_msgAccount(int_view.customer), 'Send interest details'); }
function int_sendHistory(kind) {
    if (!int_view) return;
    const isInt = kind === 'interest';
    if (isInt) {
        openSend(int_view.customer.mobile,
            int_msgSchedule(int_view.customer, int_view.interest_schedule || [], 'Interest Collection Status'),
            'Send interest history');
    } else {
        openSend(int_view.customer.mobile,
            int_msgHistory(int_view.customer, int_view.principal_history, 'Principal Collection History'),
            'Send principal history');
    }
}

// ---- collect (from inside View) ----
function int_fillCollectBox(c) {
    $('int_collectCustomerBox').innerHTML = `
        <b>Name:</b> ${esc(c.name)} &nbsp; <b>Mobile:</b> ${esc(c.mobile)}<br>
        <b>Principal:</b> ${esc(c.principal)} &nbsp; <b>Rate of Interest:</b> ${esc(c.rate_of_interest)}%
        &nbsp; <b>Total Paid Interest:</b> ${esc(c.total_interest_collected)}`;
}
function int_openCollectModal(mode) {
    const c = int_currentCustomer;
    if (+c.is_active !== 1) { alert('This customer is inactive. Set it to Active to accept payments.'); return; }
    $('int_collectMode').value = mode;
    $('int_collectCustomerId').value = c.id;
    $('int_collectTitle').textContent = mode === 'interest' ? 'Interest Collection' : 'Principal Collection';
    int_fillCollectBox(c);
    // Interest amount is auto-calculated as principal x rate%; principal collection stays manual.
    $('int_collectAmount').value = mode === 'interest'
        ? (parseFloat(c.principal) * parseFloat(c.rate_of_interest) / 100).toFixed(2) : '';
    $('int_collectDate').value = todayStr();
    openModal('int_collectModal');
}

// ---- quick pay (row-level, interest = principal x rate%) ----
function int_quickPay(id) {
    apiGet('interest_api.php?action=view&id=' + id).then(d => {
        if (!d.success) return;
        const c = d.customer;
        if (+c.is_active !== 1) { alert('This customer is inactive. Set it to Active to accept payments.'); return; }
        int_currentCustomer = c;
        $('int_collectMode').value = 'interest';
        $('int_collectCustomerId').value = id;
        $('int_collectTitle').textContent = 'Interest Payment (Auto-calculated)';
        int_fillCollectBox(c);
        $('int_collectAmount').value = (parseFloat(c.principal) * parseFloat(c.rate_of_interest) / 100).toFixed(2);
        $('int_collectDate').value = todayStr();
        openModal('int_collectModal');
    });
}
function int_submitCollect(andSend) {
    const mode = $('int_collectMode').value;
    const id = $('int_collectCustomerId').value;
    const amount = $('int_collectAmount').value;
    const date = $('int_collectDate').value;
    const c = int_currentCustomer;
    apiPost(`interest_api.php?action=${mode === 'interest' ? 'collect_interest' : 'collect_principal'}`, { id, amount, date }).then(res => {
        if (!res.success) { alert(res.message || 'Failed'); return; }
        closeModal('int_collectModal'); closeModal('int_viewModal'); int_loadTable();
        if (andSend) openSend(c.mobile, int_msgReceipt(c, mode, amount, date, res.status), 'Send payment receipt');
    });
}

// ================= RENT MODULE =================
let rnt_rows = [], rnt_status = 'active', rnt_currentCustomer = null, rnt_view = null;

function rnt_loadTable() {
    const q = $('rnt_searchBox').value;
    return apiGet(`rent_api.php?action=list&q=${encodeURIComponent(q)}`).then(d => {
        rnt_rows = d.rows;
        rnt_render();
    });
}

function rnt_render() {
    segCounts('rnt', rnt_rows);
    const rows = segFilter(rnt_rows, rnt_status);
    const body = $('rnt_tableBody');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="7">No records found.</td></tr>'; return; }
    body.innerHTML = rows.map(r => {
        const act = +r.is_active === 1;
        const payOff = !act || +r.has_pending === 0;
        return `<tr class="${act ? '' : 'row-inactive'}">
            <td data-label="Name">${esc(r.name)}</td>
            <td data-label="Mobile"><span onclick="makeCall('${esc(r.mobile)}')" style="color:var(--heading);cursor:pointer;text-decoration:underline;font-weight:600;" title="Call ${esc(r.mobile)}">${esc(fmtMobile(r.mobile))}</span></td>
            <td data-label="Rent Amount">${esc(r.rent_amount)}</td>
            <td data-label="Agreement Date">${esc(r.agreement_date)}</td>
            <td data-label="This Month"><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
            <td data-label="Status">${statusBadge(r)}</td>
            <td class="actions">
                <button class="btn btn-view" onclick="rnt_viewCustomer(${r.id})">View</button>
                <button class="btn btn-pay" ${payOff ? 'disabled' : ''} ${act ? '' : `title="${INACTIVE_TIP}"`} onclick="rnt_openPayModal(${r.id})">Pay Rent</button>
                <button class="btn btn-send" onclick="rnt_sendRow(${r.id})">📤 Send</button>
                <button class="btn btn-toggle" onclick="rnt_toggle(${r.id}, ${act ? 0 : 1})">${act ? 'Set Inactive' : 'Set Active'}</button>
            </td></tr>`;
    }).join('');
}

// ---- messages ----
function rnt_msgAccount(c, history) {
    const lines = ['Rent Details', '',
        `Name: ${c.name}`,
        `Rent Amount: ${inr(c.rent_amount)}`, `Agreement Date: ${c.agreement_date}`,
        `This Month: ${c.status === 'paid' ? 'Paid' : 'Pending'}`,
        `Status: ${+c.is_active === 1 ? 'Active' : 'Inactive'}`];
    if (history && history.length) {
        lines.push('', 'Payment History:');
        history.forEach(r => lines.push(`${r.payment_date}  ${inr(r.amount)}`));
    }
    return lines.join('\n');
}
function rnt_msgReceipt(c, amount, date) {
    return ['Rent Payment Receipt', '',
        `Name: ${c.name}`, `Amount Paid: ${inr(amount)}`, `Date: ${date}`,
        `For Month: ${date.slice(0, 7)}`, '', 'Thank you.'].join('\n');
}

function rnt_sendRow(id) {
    const c = rnt_rows.find(r => r.id == id);
    if (c) openSend(c.mobile, rnt_msgAccount(c), 'Send rent details');
}
async function rnt_toggle(id, makeActive) {
    if (await setActive('rent_api.php', id, makeActive)) rnt_loadTable();
}

// ---- add ----
async function rnt_openAdd() {
    const f = $('rnt_addForm'); f.reset();
    f.elements.namedItem('agreement_date').value = todayStr();
    await contactToForm('rnt_addForm');
    openModal('rnt_addModal');
}
function rnt_submitAdd(andSend) {
    const f = $('rnt_addForm');
    const data = Object.fromEntries(new FormData(f).entries());
    apiPost('rent_api.php?action=add', data).then(res => {
        if (!res.success) { alert(res.message || 'Failed to save.'); return; }
        closeModal('rnt_addModal'); f.reset(); rnt_loadTable();
        if (andSend) openSend(res.mobile, rnt_msgAccount({
            name: data.name, rent_amount: data.rent_amount,
            agreement_date: data.agreement_date, status: 'pending', is_active: 1 }), 'Send rent details');
    });
}

// ---- view / pay ----
function rnt_viewCustomer(id) {
    apiGet('rent_api.php?action=view&id=' + id).then(d => {
        if (!d.success) { alert('Not found'); return; }
        rnt_view = d;
        const c = d.customer;
        $('rnt_viewCustomerBox').innerHTML = `
            <b>Name:</b> ${esc(c.name)} &nbsp; <b>Mobile:</b> <span onclick="makeCall('${esc(c.mobile)}')" style="color:var(--heading);cursor:pointer;text-decoration:underline;font-weight:600;" title="Call ${esc(c.mobile)}">${esc(fmtMobile(c.mobile))}</span><br>
            <b>Rent Amount:</b> ${esc(c.rent_amount)} &nbsp; <b>Agreement Date:</b> ${esc(c.agreement_date)}<br>
            <b>This month:</b> <span class="badge ${esc(c.status)}">${esc(c.status)}</span> &nbsp; <b>Status:</b> ${statusBadge(c)}`;
        $('rnt_historyBox').innerHTML = d.schedule && d.schedule.length
            ? '<table><tr><th>Due Date</th><th>Rent Amount</th><th>Collected</th><th>Status</th><th>Paid Date</th></tr>' +
              d.schedule.slice().reverse().map(r => `<tr><td>${esc(r.due_date)}</td><td>${esc(r.due_amount)}</td><td>${esc(r.collected)}</td>
                  <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td><td>${esc(r.paid_date || '-')}</td></tr>`).join('') + '</table>'
            : 'No due dates yet';
        openModal('rnt_viewModal');
    });
}
function rnt_sendCustomer() { if (rnt_view) openSend(rnt_view.customer.mobile, rnt_msgAccount(rnt_view.customer, rnt_view.history), 'Send rent details'); }

function rnt_openPayModal(id) {
    apiGet('rent_api.php?action=view&id=' + id).then(d => {
        if (!d.success) return;
        const c = d.customer;
        if (+c.is_active !== 1) { alert('This record is inactive. Set it to Active to accept payments.'); return; }
        rnt_currentCustomer = c;
        $('rnt_payCustomerId').value = id;
        $('rnt_payCustomerBox').innerHTML = `
            <b>Name:</b> ${esc(c.name)} &nbsp; <b>Mobile:</b> <span onclick="makeCall('${esc(c.mobile)}')" style="color:var(--heading);cursor:pointer;text-decoration:underline;font-weight:600;" title="Call ${esc(c.mobile)}">${esc(fmtMobile(c.mobile))}</span><br>
            <b>Rent Amount:</b> ${esc(c.rent_amount)}`;
        $('rnt_payAmount').value = c.rent_amount;
        $('rnt_payDate').value = todayStr();
        openModal('rnt_payModal');
    });
}
function rnt_submitPay(andSend) {
    const id = $('rnt_payCustomerId').value, amount = $('rnt_payAmount').value, date = $('rnt_payDate').value;
    const c = rnt_currentCustomer;
    apiPost('rent_api.php?action=pay', { id, amount, date }).then(res => {
        if (!res.success) { alert(res.message || 'Failed'); return; }
        closeModal('rnt_payModal'); rnt_loadTable();
        if (andSend) openSend(c.mobile, rnt_msgReceipt(c, amount, date), 'Send rent receipt');
    });
}

// ================= MOI MODULE (print stays; no active/inactive) =================
let moi_allRows = [];

function moi_village() { return $('moi_villageSel') ? $('moi_villageSel').value : ''; }
// "__asc" = sort by village ascending (no filter); any other value = show only that village
function moi_qs() {
    const v = moi_village();
    return v === '__asc' ? '&sort=village_asc' : `&village=${encodeURIComponent(v)}`;
}

function moi_loadVillages() {
    return apiGet('moi_api.php?action=villages').then(d => {
        const sel = $('moi_villageSel'), cur = sel.value;
        sel.innerHTML = '<option value="">🏘 Village (default order)</option><option value="__asc">🔼 All villages A → Z</option>' +
            d.villages.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        sel.value = (cur === '__asc' || d.villages.includes(cur)) ? cur : '';
    });
}

function moi_loadTable() {
    const q = $('moi_searchBox').value;
    moi_loadVillages().catch(() => {});
    return apiGet(`moi_api.php?action=list&q=${encodeURIComponent(q)}${moi_qs()}`).then(d => {
        moi_allRows = d.rows;
        // r.id ascending (skipped when "sort by village" is selected, so that option still works)
        if (!moi_qs().includes('sort=village_asc')) {
            moi_allRows.sort((a, b) => Number(a.id) - Number(b.id));
        }
        moi_renderTable();
    });
}

function moi_renderTable() {
    const body = $('moi_tableBody');
    if (!moi_allRows.length) { body.innerHTML = '<tr><td colspan="11">No records found.</td></tr>'; return; }
    const cell = (f, v, label) => `<td class="editable" data-field="${f}" data-label="${label}">${esc(v)}</td>`;
    body.innerHTML = moi_allRows.map(r => `<tr data-id="${r.id}">
            ${cell('name_tamil', r.name_tamil, 'Name')}
            ${cell('village_tamil', r.village_tamil, 'Village')}
            ${cell('mobile', r.mobile, 'Mobile')}
            ${cell('alternate_mobile', r.alternate_mobile, 'Alt Mobile')}
            ${cell('tran_date', r.tran_date, 'Tran Date')}
            ${cell('city', r.city, 'City')}
            ${cell('income', r.income, 'Income')}
            ${cell('expenditure', r.expenditure, 'Expenditure')}
            ${cell('information', r.information, 'Information')}
            <td data-label="Updated">${esc(r.up_dated)}</td>
            <td class="actions" data-label="Actions"><button class="btn btn-edit" onclick="moi_toggleEdit(${r.id}, this)">Edit</button></td>
        </tr>`).join('');
}

// ---- inline edit ----
function moi_toggleEdit(id, btn) {
    const row = document.querySelector(`#moi_tableBody tr[data-id="${id}"]`);
    if (btn.dataset.mode === 'edit') return;
    btn.dataset.mode = 'edit';
    row.querySelectorAll('.editable').forEach(c => {
        c.innerHTML = `<input type="text" value="${esc(c.textContent)}" style="width:100%;min-width:70px;padding:4px;">`;
    });
    btn.parentElement.innerHTML = `
        <button class="btn btn-save" onclick="moi_saveEdit(${id})">Save</button>
        <button class="btn btn-cancel" onclick="moi_renderTable()">Cancel</button>`;
}
function moi_saveEdit(id) {
    const row = document.querySelector(`#moi_tableBody tr[data-id="${id}"]`);
    const data = { id };
    row.querySelectorAll('.editable').forEach(c => { data[c.dataset.field] = c.querySelector('input').value; });
    apiPost('moi_api.php?action=update', data).then(res => {
        if (res.success) moi_loadTable();
        else alert(res.message || 'Update failed');
    });
}

// ---- add (name + mobile come from the phone contacts) ----
async function moi_fillFromContact() {
    const c = await pickContact();
    if (!c) return;
    const f = $('moi_addForm');
    f.elements.namedItem('name_tamil').value = c.name;
    f.elements.namedItem('mobile').value = c.mobiles[0];
    f.elements.namedItem('alternate_mobile').value = c.mobiles[1] || '';
}
async function moi_openAdd() {
    $('moi_addForm').reset();
    await moi_fillFromContact();
    openModal('moi_addModal');
}
function moi_submitAdd() {
    const f = $('moi_addForm');
    const data = Object.fromEntries(new FormData(f).entries());
    apiPost('moi_api.php?action=add', data).then(res => {
        if (res.success) { closeModal('moi_addModal'); f.reset(); moi_loadTable(); }
        else alert(res.message || 'Failed to save.');
    });
}

// ---- print PDF (name_tamil, village_tamil, income, expenditure only) ----
function moi_printPDF() {
    apiGet(`moi_api.php?action=list&q=${encodeURIComponent($('moi_searchBox').value)}${moi_qs()}`).then(d => {
        const rows = d.rows.map(r => `<tr><td>${esc(r.name_tamil)}</td><td>${esc(r.village_tamil)}</td><td>${esc(r.income)}</td><td>${esc(r.expenditure)}</td></tr>`).join('');
        printSectionHtml(`<h2 style="text-align:center">MOI Report</h2>
            <table style="width:100%;border-collapse:collapse"><tr><th>Name (Tamil)</th><th>Village (Tamil)</th><th>Income</th><th>Expenditure</th></tr>${rows}</table>`);
    });
}

// ================= REPORTS (date-range transactions - print stays) =================
function rpt_setRange(mode) {
    const today = todayStr();
    $('rpt_to').value = today;
    if (mode === 'today') $('rpt_from').value = today;
    else {
        const d = new Date(); d.setDate(d.getDate() - 30);
        $('rpt_from').value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    rpt_load();
}

function rpt_table(rows, columns) {
    if (!rows || !rows.length) return '<p style="color:#888;font-size:13px;">No records</p>';
    return '<table><tr>' + columns.map(c => `<th>${c.label}</th>`).join('') + '</tr>' +
        rows.map(r => '<tr>' + columns.map(c =>
            `<td>${c.format ? c.format(r[c.key], r) : esc(r[c.key])}</td>`).join('') + '</tr>').join('') + '</table>';
}

function rpt_load() {
    const from = $('rpt_from').value, to = $('rpt_to').value;
    if (!from || !to) return;
    apiGet(`reports_api.php?action=data&from=${from}&to=${to}`).then(d => {
        $('rpt_summary').textContent = `Report period: ${d.from} to ${d.to}`;
        const badge = v => `<span class="badge ${esc(v)}">${esc(v)}</span>`;
        const money = v => parseFloat(v).toFixed(2);
        const base = [{ key: 'date', label: 'Date' }, { key: 'name', label: 'Name' }];
        const total = t => `<p><b>Total: ${money(t)}</b></p>`;

        $('rpt_borrowerCollections').innerHTML = rpt_table(d.borrower.collections,
            [...base, { key: 'amount', label: 'Amount', format: money }, { key: 'status', label: 'Status', format: badge }]) + total(d.borrower.collections_total);
        $('rpt_borrowerNew').innerHTML = rpt_table(d.borrower.new_entries,
            [...base, { key: 'amount', label: 'Amount Given', format: money }, { key: 'payment_type', label: 'Schedule' }]) + total(d.borrower.new_entries_total);
        $('rpt_interestCollections').innerHTML = rpt_table(d.interest.interest_collections,
            [...base, { key: 'amount', label: 'Amount', format: money }, { key: 'status', label: 'Status', format: badge }]) + total(d.interest.interest_collections_total);
        $('rpt_principalCollections').innerHTML = rpt_table(d.interest.principal_collections,
            [...base, { key: 'amount', label: 'Amount', format: money }, { key: 'status', label: 'Status', format: badge }]) + total(d.interest.principal_collections_total);
        $('rpt_interestNew').innerHTML = rpt_table(d.interest.new_entries,
            [...base, { key: 'amount', label: 'Principal Given', format: money }, { key: 'rate_of_interest', label: 'Rate %' }]) + total(d.interest.new_entries_total);
        $('rpt_rentCollections').innerHTML = rpt_table(d.rent.collections,
            [...base, { key: 'amount', label: 'Amount', format: money }]) + total(d.rent.collections_total);
        $('rpt_rentNew').innerHTML = rpt_table(d.rent.new_entries,
            [...base, { key: 'amount', label: 'Rent Amount', format: money }]) + total(d.rent.new_entries_total);
    });
}

function rpt_printAll() {
    const section = (title, id) => `<h3>${title}</h3>${$(id).innerHTML}`;
    printSectionHtml(`
        <h2>Transaction Report</h2>
        <p><b>${esc($('rpt_summary').textContent)}</b></p>
        ${section('🤝 Borrower — Due Collected', 'rpt_borrowerCollections')}
        ${section('🤝 Borrower — New Entries (Amount Given)', 'rpt_borrowerNew')}
        ${section('💰 Interest Collected', 'rpt_interestCollections')}
        ${section('💰 Principal Collected', 'rpt_principalCollections')}
        ${section('💰 New Interest Entries (Principal Given)', 'rpt_interestNew')}
        ${section('🏠 Rent Collected', 'rpt_rentCollections')}
        ${section('🏠 New Rent Entries', 'rpt_rentNew')}`);
}

// ================= SUMMARY (KPIs + graphs) =================
function sum_load() {
    $('sum_body').innerHTML = '<p class="hint">Loading...</p>';
    apiGet('reports_api.php?action=summary').then(sum_render).catch(() => {
        $('sum_body').innerHTML = '<p style="color:#e63946">Could not load the summary.</p>';
    });
}

function sum_render(d) {
    const kpi = (label, value, cls) => `<div class="kpi ${cls || ''}"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div></div>`;
    const card = (title, inner, note) => `<div class="chart-card"><h3>${title}</h3>${inner}${note ? `<p class="note">${note}</p>` : ''}</div>`;
    const b = d.borrower, i = d.interest, r = d.rent, m = d.moi;
    const cf = v => 'Rs. ' + chartFmt(v);   // compact labels above bars (exact figures are in the cards)
    const C = { good: '#2a9d8f', blue: '#457b9d', bad: '#e76f51', warn: '#f4a261', purple: '#8e6bbf', red: '#e63946' };
    $('sum_asof').textContent = `As of ${d.generated}`;

    const nm = d.names || { borrower: [], interest: [], rent: [], moi: [] };
    const PAID = '✔ Fully paid';
    // tooltip text: title + "Name: amount" lines (zero amounts skipped unless tagged)
    const tl = (title, arr, val, tag) => {
        const a = arr.map(x => [x.name, val(x), tag ? tag(x) : '']).filter(x => x[1] > 0 || x[2]);
        if (!a.length) return '';
        return title + '\n' + a.slice(0, 20).map(x => `${x[0]}: ${inr(x[1])}${x[2] ? ' ' + x[2] : ''}`).join('\n') + (a.length > 20 ? `\n+${a.length - 20} more` : '');
    };
    // visible table: name, total, outstanding / fully paid
    const det = (title, rows) => rows.length ? `<details class="sum-section" open><summary><b>${title}</b> (${rows.length})</summary>
        <div style="overflow-x:auto"><table class="sum-table"><tr><th>Name</th><th>Total</th><th>Outstanding / Status</th></tr>${
        rows.map(r => `<tr><td>${esc(r[0])}</td><td>${inr(r[1])}</td><td>${r[2] > 0 ? inr(r[2]) : PAID}</td></tr>`).join('')}</table></div></details>` : '';
    const B = nm.borrower, I = nm.interest, R = nm.rent, M = nm.moi;
    const Bdone = x => x.out <= 0, Idone = x => x.cat === 'completed';
    const rentOpen = R.filter(x => !x.paid);
    // ----- Borrower -----
    const borrower = `
      <div class="sum-section"><h2>🤝 Borrower</h2>
        <div class="kpi-grid">
          ${kpi('Total Borrowers', b.count)}
          ${kpi('Total Principal', inr(b.principal))}
          ${kpi('Due Collected', inr(b.due_collected), 'good')}
          ${kpi('Pending (Principal − Balance)', inr(b.pending), 'bad')}
          ${kpi('Completed', b.completed.count, 'good')}
          ${kpi('Not Completed', b.incomplete.count, 'warn')}
        </div>
        <div class="chart-grid">
          ${card('Principal vs Collected vs Pending', chartBar([
              { label: 'Total Principal', value: b.principal, color: C.blue, tip: tl('Principal:', B, x => x.principal) },
              { label: 'Due Collected', value: b.due_collected, color: C.good, tip: tl('Paid:', B, x => x.paid, x => Bdone(x) ? PAID : '') },
              { label: 'Pending', value: b.pending, color: C.bad, tip: tl('Outstanding:', B, x => x.out) }], cf))}
          ${card('Completed vs Not Completed', chartDonut([
              { label: 'Completed', value: b.completed.count, color: C.good, tip: tl('Fully paid:', B.filter(Bdone), x => x.principal, () => PAID) },
              { label: 'Not completed', value: b.incomplete.count, color: C.bad, tip: tl('Outstanding:', B.filter(x => !Bdone(x)), x => x.out) }], 'borrowers'))}
        </div>
        <table class="sum-table" style="margin-top:14px">
          <tr><th>Status</th><th>Borrowers</th><th>Principal</th><th>Pending</th></tr>
          <tr><td>Completed</td><td>${b.completed.count}</td><td>${inr(b.completed.principal)}</td><td>${inr(0)}</td></tr>
          <tr><td>Not completed</td><td>${b.incomplete.count}</td><td>${inr(b.incomplete.principal)}</td><td>${inr(b.incomplete.pending)}</td></tr>
          <tr><td><b>Total</b></td><td><b>${b.count}</b></td><td><b>${inr(b.principal)}</b></td><td><b>${inr(b.pending)}</b></td></tr>
        </table>
      </div>`;

    // ----- Interest -----
    const cat = i.categories;
    const openCat = {};   // "not completed" = partial + no principal yet
    ['count', 'principal', 'principal_collected', 'principal_balance', 'interest_collected', 'overdue_interest'].forEach(k => {
        openCat[k] = cat.partial[k] + cat.not_started[k];
    });
    const irow = (label, c, bold) => {
        const w = t => bold ? `<b>${t}</b>` : t;
        return `<tr><td>${w(label)}</td><td>${w(c.count)}</td><td>${w(inr(c.principal))}</td><td>${w(inr(c.principal_collected))}</td>
            <td>${w(inr(c.principal_balance))}</td><td>${w(inr(c.interest_collected))}</td><td>${w(inr(c.overdue_interest))}</td></tr>`;
    };
    const interest = `
      <div class="sum-section"><h2>💰 Interest</h2>
        <div class="kpi-grid">
          ${kpi('Total Customers', i.count)}
          ${kpi('Total Principal', inr(i.principal))}
          ${kpi('Interest Collected', inr(i.interest_collected), 'good')}
          ${kpi('Interest Not Paid on Due Date', inr(i.overdue_interest), 'bad')}
          ${kpi('Principal Collected', inr(i.principal_collected), 'good')}
          ${kpi('Principal Balance', inr(i.principal_balance), 'warn')}
          ${kpi('Interest Completed', cat.completed.count, 'good')}
          ${kpi('Interest Not Completed', openCat.count, 'warn')}
          ${kpi('Principal Partial (not completed)', cat.partial.count, 'warn')}
        </div>
        <div class="chart-grid">
          ${card('Principal & Interest', chartBar([
              { label: 'Total Principal', value: i.principal, color: C.blue, tip: tl('Principal:', I, x => x.principal) },
              { label: 'Principal Collected', value: i.principal_collected, color: C.good, tip: tl('Collected:', I, x => x.pr_paid, x => Idone(x) ? PAID : '') },
              { label: 'Principal Balance', value: i.principal_balance, color: C.warn, tip: tl('Outstanding:', I, x => x.out) },
              { label: 'Interest Collected', value: i.interest_collected, color: C.purple, tip: tl('Interest paid:', I, x => x.int_paid) },
              { label: 'Interest Not Paid', value: i.overdue_interest, color: C.bad, tip: tl('Interest outstanding:', I, x => x.overdue) }], cf))}
          ${card('Customers by status', chartDonut([
              { label: 'Completed', value: cat.completed.count, color: C.good, tip: tl('Fully paid:', I.filter(Idone), x => x.principal, () => PAID) },
              { label: 'Principal partial', value: cat.partial.count, color: C.warn, tip: tl('Outstanding:', I.filter(x => x.cat === 'partial'), x => x.out) },
              { label: 'Nothing collected yet', value: cat.not_started.count, color: C.bad, tip: tl('Outstanding:', I.filter(x => x.cat === 'not_started'), x => x.out) }], 'customers'))}
        </div>
        <div style="overflow-x:auto;margin-top:14px">
        <table class="sum-table">
          <tr><th>Status</th><th>Customers</th><th>Principal</th><th>Principal collected</th><th>Principal balance</th><th>Interest collected</th><th>Interest not paid</th></tr>
          ${irow('Completed (principal fully collected)', cat.completed)}
          ${irow('Not completed (total)', openCat)}
          ${irow('&nbsp;&nbsp;↳ Principal partial', cat.partial)}
          ${irow('&nbsp;&nbsp;↳ Nothing collected yet', cat.not_started)}
          ${irow('Total', { count: i.count, principal: i.principal, principal_collected: i.principal_collected,
                principal_balance: i.principal_balance, interest_collected: i.interest_collected, overdue_interest: i.overdue_interest }, true)}
        </table></div>
        <p class="note">"Interest not paid" = full months since the loan date × (principal × rate %) − interest collected
        (for closed loans, counted up to the last principal payment).</p>
      </div>`;

    // ----- Rent -----
    const rent = `
      <div class="sum-section"><h2>🏠 House / Shop Rent <small style="font-weight:400">(${esc(r.month)})</small></h2>
        <div class="kpi-grid">
          ${kpi('Total Houses / Shops', `${r.count} <small style="font-size:12px;font-weight:400">(${r.active_count} active)</small>`)}
          ${kpi('Monthly Rent (active)', inr(r.monthly_total))}
          ${kpi('Collected this month', inr(r.collected), 'good')}
          ${kpi('Pending this month', inr(r.pending), 'bad')}
          ${kpi('Collected — all time', inr(r.collected_all_time), 'good')}
        </div>
        <div class="chart-grid">
          ${card('This month', chartBar([
              { label: 'Monthly Rent', value: r.monthly_total, color: C.blue, tip: tl('Rent:', R, x => x.rent) },
              { label: 'Collected', value: r.collected, color: C.good, tip: tl('Paid this month:', R.filter(x => x.paid), x => x.rent, () => PAID) },
              { label: 'Pending', value: r.pending, color: C.bad, tip: tl('Outstanding:', rentOpen, x => x.rent) }], cf))}
          ${card('Paid vs Pending (active)', chartDonut([
              { label: 'Paid', value: r.paid_count, color: C.good, tip: tl('Fully paid:', R.filter(x => x.paid), x => x.rent, () => PAID) },
              { label: 'Pending', value: r.pending_count, color: C.bad, tip: tl('Outstanding:', rentOpen, x => x.rent) }], 'houses / shops'))}
        </div>
      </div>`;

    // ----- MOI -----
    const moi = `
      <div class="sum-section"><h2>📇 MOI</h2>
        <div class="kpi-grid">
          ${kpi('Records', m.count)}
          ${kpi('Total Income', inr(m.income), 'good')}
          ${kpi('Total Expenditure', inr(m.expenditure), 'bad')}
          ${kpi('Income − Expenditure', inr(m.net), m.net >= 0 ? 'good' : 'bad')}
        </div>
        <div class="chart-grid">
          ${card('Income vs Expenditure', chartBar([
              { label: 'Income', value: m.income, color: C.good, tip: tl('Income:', M, x => x.income) },
              { label: 'Expenditure', value: m.expenditure, color: C.bad, tip: tl('Expenditure:', M, x => x.expenditure) }], cf))}
        </div>
      </div>`;

    // ----- Who hasn't paid on the due date (Borrower / Interest / Rent) -----
    const pend = d.pending_list || [];
    const pendRows = pend.length
        ? pend.map(p => `<tr><td>${esc(p.module)}</td><td>${esc(p.name)}</td><td>${inr(p.amount)}</td></tr>`).join('')
        : '<tr><td colspan="3">Nobody is pending - everyone is paid up to date. 🎉</td></tr>';
    const pendTotal = pend.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const pendingSection = `
      <div class="sum-section"><h2>⏰ Not Paid on Due Date</h2>
        <div class="kpi-grid">
          ${kpi('People Pending', pend.length, 'bad')}
          ${kpi('Total Amount Pending', inr(pendTotal), 'bad')}
        </div>
        <div style="overflow-x:auto;margin-top:10px">
        <table class="sum-table">
          <tr><th>Module</th><th>Name</th><th>Amount Pending</th></tr>
          ${pendRows}
        </table></div>
        <p class="note">Borrower: last due instalment not yet fully collected. Interest: interest overdue past the due month. Rent: this month's rent not yet paid.</p>
      </div>`;

    $('sum_body').innerHTML = borrower + det('🤝 Borrower — names & outstanding', B.map(x => [x.name, x.principal, x.out])) +
        interest + det('💰 Interest — names & outstanding', I.map(x => [x.name, x.principal, x.out])) +
        rent + det('🏠 Rent — names & this month', R.map(x => [x.name, x.rent, x.paid ? 0 : x.rent])) + moi + pendingSection;
}

function sum_print() {
    printSectionHtml(`<h2>Summary Report</h2><p><b>${esc($('sum_asof').textContent)}</b></p>${$('sum_body').innerHTML}`);
}

// ================= WIRING / START-UP =================
function loadAllTables() {
    bor_loadTable(); int_loadTable(); rnt_loadTable(); moi_loadTable();
}

['bor', 'int', 'rnt', 'moi'].forEach(p => {
    const box = $(p + '_searchBox');
    box.addEventListener('input', debounce(() => {
        const chip = $(p + '_chip'); if (chip) chip.hidden = true; // typed search replaces the contact filter
        window[p + '_loadTable']();
    }, 350));
    setupVoiceSearch(p + '_micBtn', p + '_searchBox');
});
segInit('bor', s => { bor_status = s; bor_render(); });
segInit('int', s => { int_status = s; int_render(); });
segInit('rnt', s => { rnt_status = s; rnt_render(); });

let moi_sortAsc = {};
document.querySelectorAll('#moi_moiTable th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const col = parseInt(th.dataset.col);
        moi_sortAsc[col] = !moi_sortAsc[col];
        sortTableByColumn($('moi_moiTable'), col, moi_sortAsc[col]);
    });
});

// Called by the native layer (src/main.js) once the fingerprint / screen-lock check has passed and
// the local database is open. Nothing touches the database before that.
window.appBoot = function () {
    showPage('borrower');   // first page = Borrower, second = Interest
    rpt_setRange('today');
    loadAllTables();
    window.NativeBridge.backupStatus().then(d => {
        const days = d.last ? Math.floor((Date.now() - new Date(d.last).getTime()) / 86400000) : null;
        if (days === null || days >= 7) toast(days === null ? 'Reminder: no backup taken yet (🗄 Backup).' : `Reminder: last backup was ${days} days ago (🗄 Backup).`, 'warn');
    }).catch(() => {});
};
// After a re-lock/unlock the data is refreshed in case anything changed.
window.appResume = function () { loadAllTables(); };
