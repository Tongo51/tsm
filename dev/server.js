// เครื่องมือ dev: จำลอง Apps Script + Google Sheet ในหน่วยความจำ แล้วรัน gas/Code.js ตัวจริง
//   node dev/server.js        → เปิดหน้าเว็บ http://localhost:8787 (ยิง API มาที่ /api)
//   node dev/server.js test   → รันชุดทดสอบ logic หลัก (login, สิทธิ์, บันทึก, dashboard)
const fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http'), crypto = require('crypto');

// ---------- mock Apps Script ----------
const TZ = 'Asia/Bangkok';
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
let VDate; // Date ของ vm context — ให้ instanceof Date ใน Code.js ทำงานเหมือนบน Apps Script
function makeSheet(name) {
  const rows = [], textCols = new Set();
  // ชีตจริงแปลง "2026-10-18" เป็น Date ถ้าคอลัมน์ไม่ได้ตั้งเป็นข้อความ — จำลองพฤติกรรมนั้น
  const coerce = (v, c) => typeof v === 'string' && !textCols.has(c) && isoDay.test(v) ? new VDate(v + 'T00:00:00+07:00')
    : typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
  const range = (r, c, nr = 1, nc = 1) => ({
    setValues(vals) { vals.forEach((row, i) => { const k = r - 1 + i; rows[k] = rows[k] || []; row.forEach((v, j) => { rows[k][c - 1 + j] = coerce(v, c + j); }); }); return this; },
    getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')); },
    setFontWeight() { return this; }, setBackground() { return this; },
    setNumberFormat(f) { if (f === '@') textCols.add(c); return this; },
  });
  return {
    name, rows, getRange: range, getLastRow: () => rows.length, getMaxRows: () => 1000, setFrozenRows() {},
    appendRow(vals) { rows.push(vals.map((v, j) => coerce(v, j + 1))); return this; },
    deleteRow(r) { rows.splice(r - 1, 1); },
  };
}
const book = { sheets: [makeSheet('ชีต1')],
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; },
  insertSheet(n) { const s = makeSheet(n); this.sheets.push(s); return s; },
  deleteSheet(s) { this.sheets.splice(this.sheets.indexOf(s), 1); },
  getSheets() { return this.sheets; }, getSpreadsheetTimeZone: () => TZ };
const toBuf = x => Buffer.from(typeof x === 'string' ? x : x.map(b => b & 255));
const props = {}, cache = {}, logs = [];
const ctx = {
  SpreadsheetApp: { openById: () => book },
  Utilities: {
    computeHmacSha256Signature: (m, k) => [...crypto.createHmac('sha256', k).update(m).digest()].map(b => b > 127 ? b - 256 : b),
    base64EncodeWebSafe: x => toBuf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: s => [...Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')],
    newBlob: x => ({ getBytes: () => [...toBuf(x)], getDataAsString: () => toBuf(x).toString('utf8') }),
    getUuid: () => crypto.randomUUID(),
    formatDate(d, tz, p) {
      const o = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).map(x => [x.type, x.value]));
      return p.replace('yyyy', o.year).replace('MM', o.month).replace('dd', o.day).replace('HH', o.hour).replace('mm', o.minute);
    },
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
  Logger: { log: m => logs.push(m) },
};
ctx.INGEST_KEY = 'dev-key';  // ของจริงอยู่ใน gas/secret.js
vm.createContext(ctx);
VDate = vm.runInContext('Date', ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas/Code.js'), 'utf8'), ctx);
const call = (action, body = {}) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action, ...body }) } }).s);

ctx.setup();
const adminPw = String(logs.pop()).match(/รหัสผ่าน: (\S+)/)[1];

// ---------- test ----------
if (process.argv[2] === 'test') {
  const assert = require('assert');
  const ok = r => { assert(r.ok, r.error); return r.data; };
  assert.deepStrictEqual(book.sheets.map(s => s.name), ['ผู้ใช้', 'รถ', 'บันทึกการใช้รถ', 'ค่าน้ำมัน', 'ซ่อมบำรุง']);
  assert(!call('login', { username: 'admin', password: 'wrong' }).ok);
  const A = ok(call('login', { username: 'ADMIN', password: adminPw }));
  const at = A.token;
  assert(call('boot', { token: at + 'x' }).relogin, 'โทเคนปลอมต้องให้ล็อกอินใหม่');
  ok(call('saveUser', { token: at, isNew: true, user: { username: 'somchai', name: 'สมชาย', role: 'staff', password: 'pass1234', tsmExpire: '2026-10-25' } }));
  ok(call('saveUser', { token: at, isNew: true, user: { username: 'somsri', name: 'สมศรี', role: 'staff', password: 'pass1234' } }));
  assert(!call('saveUser', { token: at, isNew: true, user: { username: 'somchai', name: 'x', password: 'pass1234' } }).ok, 'ห้ามชื่อซ้ำ');
  ok(call('saveVehicle', { token: at, isNew: true, vehicle: { plate: '70-1234', name: 'อีซูซุ 6 ล้อ', taxExpire: '2026-11-01', staff: ['somchai', 'ghost'] } }));
  ok(call('saveVehicle', { token: at, isNew: true, vehicle: { plate: 'ผก 999', name: 'กระบะ' } }));
  const S = ok(call('login', { username: 'somchai', password: 'pass1234' })), st = S.token;
  assert.deepStrictEqual(S.vehicles.map(v => v.plate), ['70-1234', 'ผก 999'], 'ผู้ควบคุมรถเห็นทุกคัน แม้ไม่ได้ประจำ');
  assert.deepStrictEqual(S.vehicles[0].staff, ['somchai'], 'ตัดผู้ใช้ที่ไม่มีจริงออก');
  const d = ctx.Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), m = d.slice(0, 7);
  ok(call('add', { token: st, table: 'usage', row: { date: d, plate: '70-1234', startKm: 1000, endKm: 1120, purpose: 'ส่งน้ำแข็ง' } }));
  assert(!call('add', { token: st, table: 'usage', row: { date: d, plate: '70-1234', startKm: 1200, endKm: 1100, purpose: 'x' } }).ok, 'ไมล์ถอยหลัง');
  assert(!call('add', { token: st, table: 'usage', row: { date: d, plate: 'ไม่มีคันนี้', startKm: 1, endKm: 2, purpose: 'x' } }).ok, 'ทะเบียนที่ไม่มีในระบบ');
  ok(call('add', { token: st, table: 'fuel', row: { date: d, plate: '70-1234', km: 1120, liters: 40, amount: 1300 } }));
  ok(call('add', { token: at, table: 'repair', row: { date: d, plate: '70-1234', kind: 'บำรุงรักษา', km: 1120, detail: '=เปลี่ยนน้ำมันเครื่อง', cost: 1800, nextKm: 1500 } }));
  const rep = ok(call('list', { token: st, table: 'repair', month: m }));
  assert.strictEqual(rep[0].detail, '=เปลี่ยนน้ำมันเครื่อง', 'ข้อความขึ้นต้น = ต้องไม่กลายเป็นสูตร');
  const D = ok(call('dashboard', { token: at, month: m }));
  assert.deepStrictEqual(D.totals, { distance: 120, liters: 40, fuel: 1300, repair: 1800, trips: 1, vehicles: 2 });
  assert.strictEqual(D.vehicles[0].kmPerL, 3);
  assert.strictEqual(D.trend.length, 6); assert.strictEqual(D.trend[5].month, m);
  assert(D.alerts.some(a => a.title === '70-1234' && /บำรุงรักษา อีก 380/.test(a.text)), 'เตือนบำรุงรักษา');
  assert(D.alerts.some(a => a.title === 'สมชาย' && /TSM/.test(a.text)), 'เตือน TSM หมดอายุ');
  const fuelId = ok(call('list', { token: st, table: 'fuel' }))[0].id;
  const S2 = ok(call('login', { username: 'somsri', password: 'pass1234' }));
  assert(!call('del', { token: S2.token, table: 'fuel', id: fuelId }).ok, 'ลบของคนอื่นไม่ได้');
  ok(call('del', { token: st, table: 'fuel', id: fuelId }));
  const np = ok(call('changePassword', { token: st, old: 'pass1234', password: 'newpass99' }));
  assert(call('boot', { token: st }).relogin, 'เปลี่ยนรหัสแล้วโทเคนเก่าต้องใช้ไม่ได้');
  ok(call('boot', { token: np.token }));
  assert(!call('saveVehicle', { token: np.token, vehicle: { plate: 'x' } }).ok, 'พนักงานใช้หน้าแอดมินไม่ได้');
  ok(call('delUser', { token: at, username: 'somchai' }));
  assert.deepStrictEqual(ok(call('boot', { token: at })).vehicles[0].staff, [], 'ลบผู้ใช้แล้วหลุดจากรถ');
  assert(call('boot', { token: np.token }).relogin, 'ผู้ใช้ที่ถูกลบต้องเข้าไม่ได้');
  // ---- แอปขายส่งปิดวันเข้ามา ----
  ok(call('saveVehicle', { token: at, vehicle: { plate: '70-1234', name: 'อีซูซุ 6 ล้อ', line: 'l1' } }));
  assert(/ผูกกับรถ 70-1234/.test(call('saveVehicle', { token: at, vehicle: { plate: 'ผก 999', line: 'L1' } }).error), 'สายซ้ำคันไม่ได้');
  assert(!call('posVehicles', { key: 'wrong' }).ok, 'กุญแจผิดต้องเข้าไม่ได้');
  assert(!call('posVehicles', { token: at }).ok, 'โทเคนผู้ใช้ใช้กับคำสั่งแอปขายไม่ได้');
  const pv = ok(call('posVehicles', { key: 'dev-key' }));
  assert.strictEqual(pv.find(v => v.plate === '70-1234').line, 'L1');
  const day = { key: 'dev-key', date: '2026-10-17', line: 'L1', plate: '70-1234', employees: ['ต้น', 'เอ'], startKm: 1120, endKm: 1200, fuel: 1000, liters: 30, gas: 300 };
  assert(/ลิตร/.test(call('posDay', { ...day, liters: '' }).error), 'มีค่าน้ำมันต้องมีลิตร');
  assert.strictEqual(ok(call('list', { token: at, table: 'fuel', month: '2026-10' })).filter(r => r.id.startsWith('pos-')).length, 0, 'ตรวจไม่ผ่านต้องไม่เขียนอะไรเลย');
  ok(call('posDay', day));
  ok(call('posDay', { ...day, endKm: 1210, gas: 0 }));   // ส่งแก้ไข: ทับแถวเดิม ลบแก๊สออก
  const pu = ok(call('list', { token: at, table: 'usage', month: '2026-10' })).filter(r => r.id.startsWith('pos-'));
  const pf = ok(call('list', { token: at, table: 'fuel', month: '2026-10' })).filter(r => r.id.startsWith('pos-'));
  assert.deepStrictEqual([pu.length, pu[0].distance, pu[0].by], [1, 90, 'ต้น, เอ']);
  assert.deepStrictEqual(pf.map(r => [r.station, r.amount, r.km]), [['น้ำมัน', 1000, 1210]]);
  assert(!call('posDay', { ...day, plate: 'ไม่มี' }).ok, 'ทะเบียนที่ไม่มีในระบบ');
  const lg = book.getSheetByName('log').rows.map(r => r[8]);
  assert(lg.length === 5 && /ERROR: .*ลิตร/.test(lg[1]) && lg[2] === 'OK' && /ERROR: ไม่พบรถ/.test(lg[4]), 'จดทุกครั้งที่แอปขายส่งมา ทั้งผ่านและไม่ผ่าน');
  for (let i = 0; i < 5; i++) call('login', { username: 'somsri', password: 'bad' });
  assert(/15 นาที/.test(call('login', { username: 'somsri', password: 'pass1234' }).error), 'ล็อกหลังผิด 5 ครั้ง');
  console.log('ALL TESTS PASSED');
  process.exit(0);
}

// ---------- dev server ----------
const docs = path.join(__dirname, '../docs');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(ctx.doPost({ postData: { contents: body } }).s); });
    return;
  }
  const f = path.join(docs, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(docs) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8787, () => console.log('dev: http://localhost:8787  (admin / ' + adminPw + ')'));
