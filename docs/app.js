'use strict';
// สมุดประจำรถ — client บางๆ: ส่งคำสั่งไป Apps Script แล้ววาดผล กติกาทั้งหมดอยู่ฝั่ง server (gas/Code.js)
const API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/api'
  : 'https://script.google.com/macros/s/AKfycbxu0EcH5P0lXWCKOCp64f45jqpwim1EDujU5pHIJBsRcdb300PODpiuY-V2nAHbLD9c/exec';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* โหมดส่วนตัว */ } },
};
let token = store.get('tsm.token'), S = null;            // S = { user, vehicles, names, users, serviceWarnKm }
let plate = store.get('tsm.plate'), view = 'record', recType = 'usage', hisType = 'usage', admTab = 'vehicles';

// ================= utils =================
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const n = v => nf.format(Number(v) || 0);
const baht = v => '฿' + n(v);
const compact = v => v >= 1e6 ? n(Math.round(v / 1e5) / 10) + 'M' : v >= 1e3 ? n(Math.round(v / 100) / 10) + 'K' : n(Math.round(v));
const today = () => new Date().toLocaleDateString('en-CA');
const asDate = d => new Date(d + 'T00:00:00');
const thDate = (d, o = { day: 'numeric', month: 'short', year: '2-digit' }) => d ? asDate(d).toLocaleDateString('th-TH', o) : '–';
const thMonth = (ym, month = 'long') => asDate(ym + '-01').toLocaleDateString('th-TH', { month, year: 'numeric' });
const nameOf = u => (S.names && S.names[u]) || u;
const isAdmin = () => S.user.role === 'admin';
const sumOf = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
const ICON = {
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
};

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), bad ? 4200 : 2400);
}
function busy(btn, on) { if (btn) { btn.disabled = on; btn.classList.toggle('busy', on); } }
// ยืนยันแบบแตะซ้ำ (แทน confirm): แตะแรกปุ่มกลายเป็นสีแดง แตะซ้ำภายใน 4 วิ = ยืนยัน
function arm(btn, label, fn) {
  if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = btn.dataset.orig; return fn(); }
  btn.dataset.orig = btn.textContent; btn.textContent = label; btn.classList.add('armed');
  setTimeout(() => { if (btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = btn.dataset.orig; } }, 4000);
}

async function api(action, body = {}) {
  let res;
  try {
    res = await (await fetch(API, { method: 'POST', body: JSON.stringify({ action, token, ...body }) })).json();
  } catch (e) {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  }
  if (!res.ok) { if (res.relogin && action !== 'login') logout(); throw new Error(res.error); }
  return res.data;
}

// ================= session =================
function show(id) { ['#splash', '#login', '#app'].forEach(s => $(s).classList.toggle('hidden', s !== id)); }
function logout() { token = null; S = null; store.set('tsm.token', null); show('#login'); }
function setState(d) {
  if (d.token) { token = d.token; store.set('tsm.token', token); }
  S = { ...S, ...d };
  $('#meName').textContent = S.user.name || S.user.username;
  $('#meAv').textContent = (S.user.name || S.user.username).trim()[0] || '?';
  $('#tabAdmin').hidden = !isAdmin();
  show('#app');
  go(view === 'admin' && !isAdmin() ? 'record' : view);
}
async function start() {
  if (!token) return show('#login');
  show('#splash'); $('#splashMsg').textContent = 'กำลังโหลด…'; $('#splashRetry').classList.add('hidden');
  try { setState(await api('boot')); } catch (e) {
    if (!token) return;
    $('#splashMsg').textContent = e.message; $('#splashRetry').classList.remove('hidden');
  }
}
$('#splashRetry').onclick = start;
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target), btn = e.submitter;
  busy(btn, true); $('#loginErr').textContent = '';
  try {
    view = 'record';
    setState(await api('login', { username: f.get('username'), password: f.get('password') }));
    e.target.reset();
  } catch (err) { $('#loginErr').textContent = err.message; }
  busy(btn, false);
};

// ================= navigation =================
function go(v) {
  view = v;
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'v-' + v));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  ({ record: renderRecord, history: loadHistory, dash: loadDash, admin: renderAdmin })[v]();
  window.scrollTo({ top: 0 });
}
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) go(b.dataset.view); };
const segOn = (sel, t) => $$(sel + ' button').forEach(b => b.classList.toggle('on', b.dataset.t === t));

// ================= record =================
const plateChip = (v, on, tag = 'button', cls = '') =>
  `<${tag} class="plate${on ? ' on' : ''} ${cls}" ${tag === 'button' ? `type="button" role="option" aria-selected="${on}" data-plate="${esc(v.plate)}"` : ''}><b>${esc(v.plate)}</b>${v.name ? `<small>${esc(v.name)}</small>` : ''}</${tag}>`;
const odo = km => `<span class="odo" role="img" aria-label="เลขไมล์ ${n(km)} กิโลเมตร">${[...String(Math.floor(km)).padStart(6, '0')].map(c => `<i>${c}</i>`).join('')}</span>`;
function serviceMeter(v) {
  if (v.nextKm === '' || v.nextKm == null) return '<p class="meta">ยังไม่มีนัดบำรุงรักษา — บันทึกงาน “บำรุงรักษา” พร้อมเลขไมล์นัดครั้งถัดไป</p>';
  const span = v.nextKm - (v.serviceKm || 0), left = v.nextKm - v.lastKm;
  const pct = Math.max(0, Math.min(100, span > 0 ? (v.lastKm - v.serviceKm) / span * 100 : 100));
  const lvl = left < 0 ? 'danger' : left <= (S.serviceWarnKm || 500) ? 'warn' : '';
  return `<div class="meter ${lvl}"><div class="meter-head"><span>บำรุงรักษาครั้งถัดไปที่ ${n(v.nextKm)}</span>
    <b>${left < 0 ? 'เลยกำหนด ' + n(-left) : 'อีก ' + n(left)} กม.</b></div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
}
const current = () => S.vehicles.find(v => v.plate === plate) || S.vehicles[0];

function renderRecord() {
  $('#todayText').textContent = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const v = current();
  $('#recEmpty').classList.toggle('hidden', !!v);
  $('#recBody').classList.toggle('hidden', !v);
  if (!v) return;
  plate = v.plate;
  $('#plates').innerHTML = S.vehicles.map(x => plateChip(x, x.plate === plate)).join('');
  $('#plates').hidden = S.vehicles.length < 2;
  $('#vehCard').innerHTML = `<div class="vehicle-top"><div><span class="label">เลขไมล์ล่าสุด · ${esc(v.plate)}</span>${odo(v.lastKm)}</div>
    ${v.taxExpire ? `<span class="tag">ภาษี/พ.ร.บ. ถึง ${thDate(v.taxExpire)}</span>` : ''}</div>${serviceMeter(v)}`;
  segOn('#recSeg', recType);
  $$('form.rec').forEach(f => {
    f.hidden = f.dataset.table !== recType;
    if (!f.date.value) f.date.value = today();
    ['startKm', 'km'].forEach(k => { if (f[k] && !f[k].value && v.lastKm) f[k].value = v.lastKm; });
    calc(f);
  });
}
$('#plates').onclick = e => {
  const b = e.target.closest('[data-plate]');
  if (!b) return;
  plate = b.dataset.plate; store.set('tsm.plate', plate);
  clearKm();
  renderRecord();
};
// ล้างช่องเลขไมล์ทุกฟอร์ม ให้ renderRecord เติมเลขไมล์ล่าสุดใหม่
const clearKm = () => $$('form.rec').forEach(f => ['startKm', 'km'].forEach(k => { if (f[k]) f[k].value = ''; }));
$('#recSeg').onclick = e => { const b = e.target.closest('button'); if (b) { recType = b.dataset.t; renderRecord(); } };

function calc(f) {
  const out = f.querySelector('[data-calc]');
  if (!out) return;
  const b = out.querySelector('b');
  let val = null;
  if (out.dataset.calc === 'distance' && f.startKm.value && f.endKm.value) val = f.endKm.value - f.startKm.value;
  if (out.dataset.calc === 'price' && f.liters.value > 0 && f.amount.value) val = f.amount.value / f.liters.value;
  b.textContent = val == null ? '–' : n(val);
  out.classList.toggle('bad', val < 0);
}
$$('form.rec').forEach(f => {
  f.oninput = () => calc(f);
  f.onclick = e => {
    const q = e.target.closest('[data-add]');
    if (q) f.nextKm.value = (Number(f.km.value) || current().lastKm || 0) + Number(q.dataset.add);
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter, row = { ...Object.fromEntries(new FormData(f)), plate };
    busy(btn, true);
    try {
      const r = await api('add', { table: f.dataset.table, row });
      const v = current();
      v.lastKm = Math.max(v.lastKm, Number(r.endKm || r.km) || 0);
      if (r.kind === 'บำรุงรักษา') { v.serviceKm = r.km; v.nextKm = r.nextKm; }
      f.reset(); clearKm();
      renderRecord();
      toast('บันทึกเรียบร้อย ✓');
    } catch (err) { toast(err.message, true); }
    busy(btn, false);
  };
});

// ================= history =================
const TYPES = {
  usage: { sum: rows => `<span>${rows.length} เที่ยว</span><span>รวม <b>${n(sumOf(rows, 'distance'))}</b> กม.</span>`,
    item: r => [esc(r.purpose || 'ใช้รถ'), `${n(r.startKm)} → ${n(r.endKm)}`, `<b>${n(r.distance)} กม.</b>`] },
  fuel: { sum: rows => `<span>${n(sumOf(rows, 'liters'))} ลิตร</span><b>${baht(sumOf(rows, 'amount'))}</b>`,
    item: r => [esc(r.station || 'เติมน้ำมัน'), [r.liters ? `${n(r.liters)} ลิตร · ${n(r.amount / r.liters)} บ./ลิตร` : 'ไม่ระบุลิตร', r.km !== '' && 'ไมล์ ' + n(r.km)].filter(Boolean).join(' · '), `<b>${baht(r.amount)}</b>`] },
  repair: { sum: rows => `<span>${rows.length} รายการ</span><b>${baht(sumOf(rows, 'cost'))}</b>`,
    item: r => [esc(r.detail), [r.shop && esc(r.shop), 'ไมล์ ' + n(r.km), r.nextKm !== '' && 'นัดครั้งถัดไป ' + n(r.nextKm)].filter(Boolean).join(' · '),
      `<b>${baht(r.cost)}</b><span class="tag ${r.kind === 'ซ่อม' ? 'warn' : 'gold'}">${esc(r.kind)}</span>`] },
};
const skeleton = k => Array(k).fill('<div class="skeleton"></div>').join('');
const canDelete = r => isAdmin() || (r.by === S.user.username && String(r.at).startsWith(today()));

async function loadHistory() {
  segOn('#hisSeg', hisType);
  const sel = $('#hisPlate'), keep = sel.value;
  sel.innerHTML = '<option value="">รถทุกคัน</option>' + S.vehicles.map(v => `<option${v.plate === keep ? ' selected' : ''}>${esc(v.plate)}</option>`).join('');
  if (!$('#hisMonth').value) $('#hisMonth').value = today().slice(0, 7);
  const seq = loadHistory.seq = (loadHistory.seq || 0) + 1;   // กันผลเก่ามาทับเมื่อเปลี่ยนตัวกรองเร็วๆ
  $('#hisSum').innerHTML = ''; $('#hisList').innerHTML = skeleton(3);
  try {
    const rows = await api('list', { table: hisType, plate: sel.value, month: $('#hisMonth').value });
    if (seq !== loadHistory.seq) return;
    $('#hisSum').innerHTML = rows.length ? TYPES[hisType].sum(rows) : '';
    $('#hisList').innerHTML = rows.length ? rows.map(r => {
      const [title, sub, side] = TYPES[hisType].item(r);
      return `<div class="item"><div class="date-tile"><b>${asDate(r.date).getDate()}</b><small>${thDate(r.date, { month: 'short' })}</small></div>
        <div class="item-main"><span class="item-title">${title}</span><span class="meta num">${sub}</span>
        <span class="meta"><span class="tag">${esc(r.plate)}</span> ${esc(nameOf(r.by))}${r.note ? ' · ' + esc(r.note) : ''}</span></div>
        <div class="item-side">${side}${canDelete(r) ? `<button class="btn sm ghost" data-del="${esc(r.id)}">ลบ</button>` : ''}</div></div>`;
    }).join('') : '<div class="empty"><b>ยังไม่มีรายการในเดือนนี้</b></div>';
  } catch (err) {
    if (seq === loadHistory.seq) $('#hisList').innerHTML = `<div class="empty"><b>โหลดไม่สำเร็จ</b><p>${esc(err.message)}</p></div>`;
  }
}
$('#hisSeg').onclick = e => { const b = e.target.closest('button'); if (b) { hisType = b.dataset.t; loadHistory(); } };
$('#hisPlate').onchange = $('#hisMonth').onchange = loadHistory;
$('#hisList').onclick = e => {
  const b = e.target.closest('[data-del]');
  if (b) arm(b, 'ยืนยันลบ', async () => {
    busy(b, true);
    try { await api('del', { table: hisType, id: b.dataset.del }); toast('ลบแล้ว'); loadHistory(); }
    catch (err) { toast(err.message, true); busy(b, false); }
  });
};

// ================= dashboard =================
async function loadDash() {
  const m = $('#dashMonth').value || ($('#dashMonth').value = today().slice(0, 7));
  $('#dashSub').textContent = 'รถทุกคันในระบบ';
  const seq = loadDash.seq = (loadDash.seq || 0) + 1;
  $('#dashBody').innerHTML = `<div class="card">${skeleton(2)}</div><div class="card">${skeleton(3)}</div>`;
  try {
    const d = await api('dashboard', { month: m });
    if (seq === loadDash.seq) renderDash(d);
  } catch (err) {
    if (seq === loadDash.seq) $('#dashBody').innerHTML = `<div class="card empty"><b>โหลดไม่สำเร็จ</b><p>${esc(err.message)}</p></div>`;
  }
}
$('#dashMonth').onchange = loadDash;

function renderDash(d) {
  const t = d.totals, cost = t.fuel + t.repair;
  renderDash.last = d.trend;   // ให้ tooltip อ่าน
  $('#dashBody').innerHTML = `
    <div class="card hero">
      <span class="label">ค่าใช้จ่ายรถ ${thMonth(d.month)}</span>
      <div class="hero-num">${n(Math.round(cost))}<small>บาท</small></div>
      <div class="split"><span><i class="key fuel"></i>ค่าน้ำมัน <b>${baht(t.fuel)}</b></span><span><i class="key repair"></i>ซ่อมบำรุง <b>${baht(t.repair)}</b></span></div>
      <div class="stats">
        <div><span class="label">ระยะทาง</span><b>${n(t.distance)}</b><small>กม.</small></div>
        <div><span class="label">ต้นทุนต่อ กม.</span><b>${t.distance ? n(cost / t.distance) : '–'}</b><small>บาท</small></div>
        <div><span class="label">เที่ยววิ่ง</span><b>${n(t.trips)}</b><small>ครั้ง</small></div>
        <div><span class="label">น้ำมัน</span><b>${n(t.liters)}</b><small>ลิตร${t.liters ? ' · ' + n(t.distance / t.liters) + ' กม./ลิตร' : ''}</small></div>
      </div>
    </div>
    ${d.alerts.length ? `<div class="alerts">${d.alerts.map(a => `<div class="alert ${a.level}">${ICON[a.level]}<b>${esc(a.title)}</b><span>${esc(a.text)}</span></div>`).join('')}</div>` : ''}
    <div class="card section">
      <div class="section-head"><h3>ค่าใช้จ่าย 6 เดือน</h3><div class="legend"><span><i class="key fuel"></i>ค่าน้ำมัน</span><span><i class="key repair"></i>ซ่อมบำรุง</span></div></div>
      ${trendChart(d.trend, d.month)}
    </div>
    <div class="card section">
      <div class="section-head"><h3>รายคัน</h3><span class="meta">${n(t.vehicles)} คัน · เรียงตามค่าใช้จ่าย</span></div>
      <div>${d.vehicles.length ? d.vehicles.map(v => `<div class="veh">
        <div class="veh-top">${plateChip(v, false, 'span', 'sm')}<div class="item-main"><span class="meta">${esc(v.name || '')}</span><span class="meta num">ไมล์ล่าสุด ${n(v.lastKm)}</span></div>
          <div class="item-side"><b>${baht(v.fuel + v.repair)}</b></div></div>
        <div class="veh-nums"><span>ระยะทาง<b>${n(v.distance)} กม.</b></span><span>ค่าน้ำมัน<b>${baht(v.fuel)}</b></span><span>ซ่อมบำรุง<b>${baht(v.repair)}</b></span><span>อัตราสิ้นเปลือง<b>${v.kmPerL ? n(v.kmPerL) + ' กม./ล.' : '–'}</b></span></div>
        ${serviceMeter(v)}</div>`).join('') : '<div class="empty"><b>ยังไม่มีรถในระบบ</b></div>'}</div>
    </div>`;
  bindTip();
}

function trendChart(trend, month) {
  const max = Math.max(...trend.map(x => x.fuel + x.repair));
  if (!max) return '<div class="empty"><b>ยังไม่มีค่าใช้จ่ายในช่วงนี้</b></div>';
  const step = niceStep(max / 2), top = step * 2;
  const pct = v => v / top * 100;
  return `<div class="chart" id="chart">
      <div class="y-axis">${[0, step, top].map(v => `<span style="bottom:${pct(v)}%">${compact(v)}</span>`).join('')}</div>
      <div class="plot">${[0, step, top].map(v => `<i class="grid-line" style="bottom:${pct(v)}%"></i>`).join('')}
        ${trend.map((x, i) => {
          const sum = x.fuel + x.repair;
          return `<button class="col" data-i="${i}" aria-label="${thMonth(x.month)} ค่าน้ำมัน ${n(x.fuel)} บาท ซ่อมบำรุง ${n(x.repair)} บาท">
            ${x.month === month && sum ? `<span class="cap" style="bottom:${pct(sum)}%">${compact(sum)}</span>` : ''}
            <span class="stack" style="height:${pct(sum)}%">${x.repair ? `<i class="repair" style="flex:${x.repair}"></i>` : ''}${x.fuel ? `<i class="fuel" style="flex:${x.fuel}"></i>` : ''}</span></button>`;
        }).join('')}
      </div><div class="tip" id="tip"></div>
    </div>
    <div class="x-axis">${trend.map(x => `<span class="${x.month === month ? 'on' : ''}">${thMonth(x.month, 'short').split(' ')[0]}</span>`).join('')}</div>
    <details><summary>ดูเป็นตาราง</summary><table><thead><tr><th>เดือน</th><th>ค่าน้ำมัน</th><th>ซ่อมบำรุง</th><th>รวม</th><th>ระยะทาง</th></tr></thead>
      <tbody>${trend.map(x => `<tr><td>${thMonth(x.month, 'short')}</td><td>${n(x.fuel)}</td><td>${n(x.repair)}</td><td>${n(x.fuel + x.repair)}</td><td>${n(x.distance)} กม.</td></tr>`).join('')}</tbody></table></details>`;
  function niceStep(v) { const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= v); }
}
function bindTip() {
  const chart = $('#chart');
  if (!chart) return;
  const tip = $('#tip'), trend = [...chart.querySelectorAll('.col')];
  const showTip = col => {
    const x = renderDash.last[col.dataset.i];
    tip.innerHTML = `<b>${thMonth(x.month)}</b><div class="r"><span>ค่าน้ำมัน</span><span>${baht(x.fuel)}</span></div><div class="r"><span>ซ่อมบำรุง</span><span>${baht(x.repair)}</span></div><div class="r"><span>รวม</span><b>${baht(x.fuel + x.repair)}</b></div>`;
    const c = chart.getBoundingClientRect(), r = col.getBoundingClientRect(), half = tip.offsetWidth / 2;
    tip.style.left = Math.min(Math.max(r.left - c.left + r.width / 2, half), c.width - half) + 'px';
    tip.style.top = Math.max(col.querySelector('.stack').getBoundingClientRect().top - c.top - 8, 0) + 'px';
    tip.classList.add('show');
  };
  trend.forEach(col => { col.onmouseenter = col.onfocus = () => showTip(col); col.onmouseleave = col.onblur = () => tip.classList.remove('show'); });
}

// ================= admin =================
const roleTag = u => u.role === 'admin' ? '<span class="tag gold">ผู้ดูแล</span>' : '<span class="tag">พนักงาน</span>';
function expiryTag(d, label) {
  if (!d) return '';
  const days = Math.round((asDate(d) - asDate(today())) / 864e5);
  return `<span class="tag ${days < 0 ? 'danger' : days <= 30 ? 'warn' : ''}">${label} ${days < 0 ? 'หมดอายุแล้ว' : 'ถึง ' + thDate(d)}</span>`;
}
function renderAdmin() {
  segOn('#admSeg', admTab);
  $('#admAdd').textContent = admTab === 'vehicles' ? '+ เพิ่มรถ' : '+ เพิ่มผู้ใช้';
  const list = admTab === 'vehicles' ? S.vehicles : S.users;
  $('#admList').innerHTML = !list.length ? '<div class="empty"><b>ยังไม่มีข้อมูล</b><p>กด “+ เพิ่ม” เพื่อเริ่มต้น</p></div>'
    : admTab === 'vehicles' ? list.map((v, i) => `<button class="item" data-i="${i}">${plateChip(v, false, 'span', 'sm')}
        <span class="item-main"><span class="item-title">${esc(v.name || '–')}</span>
        <span class="meta">${v.staff.length ? 'ประจำรถ: ' + v.staff.map(u => esc(nameOf(u))).join(', ') : 'ยังไม่มีพนักงานประจำ'}</span></span>
        <span class="item-side">${v.line ? `<span class="tag gold">สาย ${esc(v.line)}</span>` : ''}${expiryTag(v.taxExpire, 'ภาษี')}<span class="meta num">${n(v.lastKm)} กม.</span></span></button>`).join('')
    : list.map((u, i) => `<button class="item" data-i="${i}"><span class="av">${esc((u.name || u.username)[0])}</span>
        <span class="item-main"><span class="item-title">${esc(u.name)}${u.username === S.user.username ? ' <span class="meta">(คุณ)</span>' : ''}</span>
        <span class="meta">${esc(u.username)}${u.tsmNo ? ' · TSM ' + esc(u.tsmNo) : ''}</span></span>
        <span class="item-side">${roleTag(u)}${expiryTag(u.tsmExpire, 'TSM')}</span></button>`).join('');
}
$('#admSeg').onclick = e => { const b = e.target.closest('button'); if (b) { admTab = b.dataset.t; renderAdmin(); } };
$('#admAdd').onclick = () => admTab === 'vehicles' ? editVehicle() : editUser();
$('#admList').onclick = e => {
  const b = e.target.closest('[data-i]');
  if (b) admTab === 'vehicles' ? editVehicle(S.vehicles[b.dataset.i]) : editUser(S.users[b.dataset.i]);
};

// dialog กลาง: ใส่ฟอร์ม → onSubmit(ข้อมูลฟอร์ม) คืนค่าจาก server แล้วปิด
const dlg = $('#dlg');
dlg.onclick = e => { if (e.target === dlg) dlg.close(); };
function openDialog(html, onSubmit, onDelete, okMsg = 'บันทึกเรียบร้อย ✓') {
  dlg.innerHTML = `<form class="dlg">${html}<p class="err" role="alert"></p><div class="dlg-foot">
    ${onDelete ? '<button type="button" class="btn danger" data-act="del">ลบ</button><span class="spacer"></span>' : ''}
    <button type="button" class="btn ghost" data-act="close">ยกเลิก</button><button class="btn primary">บันทึก</button></div></form>`;
  const form = dlg.firstElementChild, err = form.querySelector('.err');
  const run = async (btn, fn, msg) => {
    busy(btn, true); err.textContent = '';
    try { const d = await fn(); dlg.close(); if (d) setState(d); toast(msg); }
    catch (e) { err.textContent = e.message; }
    busy(btn, false);
  };
  form.onsubmit = e => { e.preventDefault(); run(e.submitter, () => onSubmit(new FormData(form)), okMsg); };
  form.querySelector('[data-act=close]').onclick = () => dlg.close();
  const del = form.querySelector('[data-act=del]');
  if (del) del.onclick = () => arm(del, 'แตะอีกครั้งเพื่อลบ', () => run(del, onDelete, 'ลบแล้ว'));
  dlg.showModal();
}
const field = (label, input) => `<label class="field"><span>${label}</span>${input}</label>`;

function editVehicle(v) {
  const isNew = !v; v = v || { staff: [] };
  openDialog(`<h3>${isNew ? 'เพิ่มรถ' : 'แก้ไขรถ ' + esc(v.plate)}</h3>
    ${field('ทะเบียนรถ', `<input name="plate" required maxlength="30" value="${esc(v.plate)}" ${isNew ? 'placeholder="เช่น 70-1234 นครปฐม"' : 'readonly'}>`)}
    ${field('ยี่ห้อ / รุ่น / ประเภท', `<input name="name" maxlength="300" value="${esc(v.name)}" placeholder="เช่น อีซูซุ 6 ล้อ ห้องเย็น">`)}
    <div class="row2">${field('ภาษี / พ.ร.บ. หมดอายุ <i>(ไม่บังคับ)</i>', `<input type="date" name="taxExpire" value="${esc(v.taxExpire)}">`)}
    ${field('สายส่งในแอปขาย <i>(ไม่บังคับ)</i>', `<input name="line" maxlength="30" autocapitalize="characters" value="${esc(v.line)}" placeholder="เช่น L1">`)}</div>
    <div class="field"><span>พนักงานประจำรถ</span><div class="checks">${S.users.map(u => `<label class="check"><input type="checkbox" name="staff" value="${esc(u.username)}"${v.staff.includes(u.username) ? ' checked' : ''}>${esc(u.name)}</label>`).join('') || '<span class="meta">ยังไม่มีผู้ใช้</span>'}</div></div>
    ${field('หมายเหตุ <i>(ไม่บังคับ)</i>', `<input name="note" maxlength="300" value="${esc(v.note)}">`)}`,
  f => api('saveVehicle', { isNew, vehicle: { ...Object.fromEntries(f), staff: f.getAll('staff') } }),
  isNew ? null : () => api('delVehicle', { plate: v.plate }));
}

function editUser(u) {
  const isNew = !u; u = u || { role: 'staff' };
  const self = u.username === S.user.username;
  openDialog(`<h3>${isNew ? 'เพิ่มผู้ใช้' : 'แก้ไขผู้ใช้'}</h3>
    <div class="row2">${field('ชื่อผู้ใช้ (ใช้ล็อกอิน)', `<input name="username" required maxlength="40" pattern="[A-Za-z0-9._\\-]{3,40}" autocapitalize="none" spellcheck="false" value="${esc(u.username)}" ${isNew ? 'placeholder="เช่น somchai"' : 'readonly'}>`)}
    ${field('ชื่อ-สกุล', `<input name="name" required maxlength="100" value="${esc(u.name)}">`)}</div>
    <div class="field"><span>สิทธิ์</span><div class="seg"><label><input type="radio" name="role" value="staff"${u.role !== 'admin' ? ' checked' : ''}${self ? ' disabled' : ''}>พนักงานผู้ควบคุมรถ</label><label><input type="radio" name="role" value="admin"${u.role === 'admin' ? ' checked' : ''}${self ? ' disabled' : ''}>ผู้ดูแลระบบ</label></div></div>
    <div class="row2">${field('เลขที่ใบรับรอง TSM', `<input name="tsmNo" maxlength="50" value="${esc(u.tsmNo)}">`)}
    ${field('ใบรับรอง TSM หมดอายุ', `<input type="date" name="tsmExpire" value="${esc(u.tsmExpire)}">`)}</div>
    ${field(isNew ? 'รหัสผ่าน' : 'ตั้งรหัสผ่านใหม่ <i>(เว้นว่างถ้าไม่เปลี่ยน)</i>', `<input type="password" name="password" minlength="6" autocomplete="new-password" ${isNew ? 'required' : ''}>`)}`,
  f => api('saveUser', { isNew, user: { ...Object.fromEntries(f), role: self ? 'admin' : f.get('role') } }),
  isNew || self ? null : () => api('delUser', { username: u.username }));
}

$('#meBtn').onclick = () => {
  const u = S.user;
  openDialog(`<h3>${esc(u.name || u.username)}</h3>
    <p class="meta">${esc(u.username)} · ${u.role === 'admin' ? 'ผู้ดูแลระบบ' : 'พนักงานผู้ควบคุมรถ'}${u.tsmNo ? ' · TSM ' + esc(u.tsmNo) : ''}${u.tsmExpire ? ' (ถึง ' + thDate(u.tsmExpire) + ')' : ''}</p>
    <button type="button" class="btn" data-act="logout">ออกจากระบบ</button>
    <hr style="border:0;border-top:1px solid var(--rule);margin:4px 0;width:100%">
    <span class="label">เปลี่ยนรหัสผ่าน</span>
    ${field('รหัสผ่านเดิม', '<input type="password" name="old" required autocomplete="current-password">')}
    ${field('รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)', '<input type="password" name="password" required minlength="6" autocomplete="new-password">')}`,
  f => api('changePassword', { old: f.get('old'), password: f.get('password') }), null, 'เปลี่ยนรหัสผ่านแล้ว ✓');
  dlg.querySelector('[data-act=logout]').onclick = () => { dlg.close(); logout(); };
};

start();
