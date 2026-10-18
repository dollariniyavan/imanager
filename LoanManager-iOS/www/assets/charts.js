// ==========================================================
// Tiny dependency-free SVG charts (works offline, follows dark mode via CSS variables)
// ==========================================================
const CHART_COLORS = ['#2a9d8f', '#457b9d', '#e76f51', '#f4a261', '#8e6bbf', '#e63946'];

// ---- tooltip with name + amount --------------------------------------------------------------
// Works with the mouse AND on a phone: it shows while the finger touches a bar / slice, follows the finger
// when it slides over the chart, and keeps updating while the page is scrolled with the finger on the graph
// (whatever bar is under the finger is the one described). It stays 3 seconds after the finger lifts.
(function () {
    let tip, hideTimer, last = null, active = false;
    const ensureTip = () => {
        if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tooltip'; document.body.appendChild(tip); }
        return tip;
    };
    const tipAt = (x, y) => {
        const el = document.elementFromPoint(x, y);
        return el && el.closest ? el.closest('[data-tip]') : null;
    };
    const hide = () => { active = false; if (tip) tip.classList.remove('show'); };
    function show(el, x, y) {
        const t = ensureTip();
        t.textContent = el.getAttribute('data-tip');
        t.classList.add('show');
        t.style.left = '0px'; t.style.top = '0px';              // measure at a known spot, then place
        const w = t.offsetWidth, h = t.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
        const left = Math.min(Math.max(8, x - w / 2), Math.max(8, vw - w - 8));
        let top = y - h - 26;                                   // above the finger so it is not covered
        if (top < 8) top = Math.min(y + 30, Math.max(8, vh - h - 8));
        t.style.left = left + 'px'; t.style.top = top + 'px';
    }
    function update(x, y) {
        const el = tipAt(x, y);
        if (el) { active = true; show(el, x, y); } else hide();
    }

    // mouse (desktop / emulator)
    document.addEventListener('mousemove', e => update(e.clientX, e.clientY));
    document.addEventListener('mouseleave', hide);

    // touch (phone)
    const touch = e => {
        const t = e.touches && e.touches[0];
        if (!t) return;
        clearTimeout(hideTimer);
        last = { x: t.clientX, y: t.clientY };
        update(last.x, last.y);
    };
    const lift = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 3000); };
    document.addEventListener('touchstart', touch, { passive: true });
    document.addEventListener('touchmove', touch, { passive: true });
    document.addEventListener('touchend', lift, { passive: true });
    document.addEventListener('touchcancel', lift, { passive: true });

    // the page scrolls under a resting finger (or during the fling): describe what is under the finger now
    window.addEventListener('scroll', () => { if (last && active) update(last.x, last.y); }, { passive: true, capture: true });
})();

// section-wide name list (set by the summary page) appended to every tooltip
window.CHART_TIP = '';
function chartNames(it) {
    const t = it.tip !== undefined ? it.tip : window.CHART_TIP;
    return t ? '\n' + esc(t) : '';
}

function chartFmt(v) {
    try { return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v); }
    catch (e) { return String(Math.round(v)); }
}

function chartScale(max) {
    if (!(max > 0)) return { step: 1, top: 4 };
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    return { step, top: step * Math.ceil(max / step) };
}

function chartWrap(label, maxChars) {
    const words = String(label).split(' ');
    const lines = [];
    let cur = '';
    words.forEach(w => {
        if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
        else cur = (cur + ' ' + w).trim();
    });
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
}

// items: [{label, value, color?}]   fmtVal: how to print the number above each bar
function chartBar(items, fmtVal) {
    const W = 560, H = 290, L = 54, R = 10, T = 26, B = 70;
    const iw = W - L - R, ih = H - T - B;
    const max = Math.max(0, ...items.map(i => i.value));
    const { step, top } = chartScale(max);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" xmlns="http://www.w3.org/2000/svg">`;
    for (let v = 0; v <= top + step / 1000; v += step) {
        const y = T + ih - (v / top) * ih;
        s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="c-grid"/>`;
        s += `<text x="${L - 6}" y="${y + 4}" text-anchor="end" class="c-txt">${chartFmt(v)}</text>`;
    }
    const bw = iw / items.length;
    const w = Math.min(64, bw * 0.62);
    items.forEach((it, k) => {
        const x = L + bw * k + (bw - w) / 2;
        const h = top ? (it.value / top) * ih : 0;
        const y = T + ih - h;
        const color = it.color || CHART_COLORS[k % CHART_COLORS.length];
        s += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(h, 1)}" rx="3" fill="${color}"
            data-tip="${esc(it.label)}: ${esc(fmtVal ? fmtVal(it.value) : chartFmt(it.value))}${chartNames(it)}"/>`;
        s += `<text x="${x + w / 2}" y="${y - 6}" text-anchor="middle" class="c-val">${fmtVal ? fmtVal(it.value) : chartFmt(it.value)}</text>`;
        chartWrap(it.label, Math.max(8, Math.floor(bw / 6.5))).forEach((ln, i) => {
            s += `<text x="${x + w / 2}" y="${T + ih + 16 + i * 13}" text-anchor="middle" class="c-txt">${esc(ln)}</text>`;
        });
    });
    return s + '</svg>';
}

// items: [{label, value, color?}]  (values are counts)
function chartDonut(items, centerSub) {
    const total = items.reduce((a, i) => a + i.value, 0);
    const R = 62, C = 2 * Math.PI * R;
    let s = `<svg viewBox="0 0 170 170" class="chart" role="img" xmlns="http://www.w3.org/2000/svg">`;
    s += `<circle cx="85" cy="85" r="${R}" fill="none" stroke="var(--line)" stroke-width="26"/>`;
    let off = 0;
    if (total > 0) {
        items.forEach((it, k) => {
            if (!it.value) return;
            const len = (it.value / total) * C;
            const color = it.color || CHART_COLORS[k % CHART_COLORS.length];
            s += `<circle cx="85" cy="85" r="${R}" fill="none" stroke="${color}" stroke-width="26"
                stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 85 85)"
                data-tip="${esc(it.label)}: ${it.value} (${total ? Math.round(it.value / total * 100) : 0}%)${chartNames(it)}"/>`;
            off += len;
        });
    }
    s += `<text x="85" y="88" text-anchor="middle" class="c-center">${total}</text>`;
    s += `<text x="85" y="106" text-anchor="middle" class="c-center-sub">${esc(centerSub || 'total')}</text></svg>`;
    const legend = items.map((it, k) => {
        const color = it.color || CHART_COLORS[k % CHART_COLORS.length];
        const pct = total ? Math.round(it.value / total * 100) : 0;
        return `<li><i style="background:${color}"></i><span>${esc(it.label)}: <b>${it.value}</b> (${pct}%)</span></li>`;
    }).join('');
    return `<div class="donut-wrap">${s}<ul class="legend">${legend}</ul></div>`;
}
