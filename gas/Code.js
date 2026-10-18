// TSM Vehicle Log API — Google Apps Script web app
// หน้าเว็บ (GitHub Pages) ส่ง POST แบบ text/plain {action, token, ...} → ตอบ JSON {ok, data | error}
// กติกา/การตรวจข้อมูลทั้งหมดอยู่ฝั่งนี้ หน้าเว็บเป็นแค่ตัวแสดงผล (เปลี่ยนหน้าเว็บได้โดยไม่แตะข้อมูล)

const SHEET_ID = '1ded0QMCrwa6s50u--_D8SeFBy-1_jvzq5F7VZ9UTgs0';
const TOKEN_DAYS = 30;        // อยู่ในระบบได้นานกี่วันก่อนต้องล็อกอินใหม่
const ALERT_DAYS = 30;        // เตือนภาษีรถ/ใบรับรอง TSM ล่วงหน้ากี่วัน
const SERVICE_WARN_KM = 500;  // เตือนบำรุงรักษาเมื่อเหลือระยะไม่ถึงกี่ กม.

// แต่ละแท็บในชีต: [key, หัวคอลัมน์, ชนิด] ชนิด: (ว่าง)=ข้อความ n=ตัวเลข d=วันที่ — ลำดับ = ลำดับคอลัมน์ในชีต
const SCHEMA = {
  Users: { tab: 'ผู้ใช้', cols: [['username', 'ชื่อผู้ใช้'], ['name', 'ชื่อ-สกุล'], ['role', 'สิทธิ์'],
    ['tsmNo', 'เลขที่ใบรับรอง TSM'], ['tsmExpire', 'ใบรับรอง TSM หมดอายุ', 'd'], ['salt', 'salt'], ['hash', 'hash']] },
  Vehicles: { tab: 'รถ', cols: [['plate', 'ทะเบียน'], ['name', 'ยี่ห้อ/รุ่น/ประเภท'],
    ['taxExpire', 'ภาษี/พ.ร.บ. หมดอายุ', 'd'], ['staff', 'พนักงานประจำรถ'], ['note', 'หมายเหตุ'], ['line', 'สายส่ง (แอปขาย)']] },
  Usage: { tab: 'บันทึกการใช้รถ', cols: [['id', 'id'], ['date', 'วันที่', 'd'], ['plate', 'ทะเบียน'],
    ['startKm', 'ไมล์เริ่ม', 'n'], ['endKm', 'ไมล์สิ้นสุด', 'n'], ['distance', 'ระยะทาง (กม.)', 'n'],
    ['purpose', 'ภารกิจ/เส้นทาง'], ['note', 'หมายเหตุ'], ['by', 'ผู้บันทึก'], ['at', 'เวลาบันทึก']] },
  Fuel: { tab: 'ค่าน้ำมัน', cols: [['id', 'id'], ['date', 'วันที่', 'd'], ['plate', 'ทะเบียน'], ['km', 'เลขไมล์', 'n'],
    ['liters', 'ลิตร', 'n'], ['amount', 'จำนวนเงิน (บาท)', 'n'], ['station', 'ปั๊ม'], ['note', 'หมายเหตุ'],
    ['by', 'ผู้บันทึก'], ['at', 'เวลาบันทึก']] },
  Repairs: { tab: 'ซ่อมบำรุง', cols: [['id', 'id'], ['date', 'วันที่', 'd'], ['plate', 'ทะเบียน'], ['kind', 'ประเภทงาน'],
    ['km', 'เลขไมล์', 'n'], ['detail', 'รายละเอียด'], ['shop', 'อู่/ร้าน'], ['cost', 'ค่าใช้จ่าย (บาท)', 'n'],
    ['nextKm', 'นัดบำรุงรักษาครั้งถัดไป (เลขไมล์)', 'n'], ['by', 'ผู้บันทึก'], ['at', 'เวลาบันทึก']] },
};
const LOGS = { usage: 'Usage', fuel: 'Fuel', repair: 'Repairs' };
const KINDS = ['บำรุงรักษา', 'ซ่อม'];
const WRITES = ['add', 'del', 'saveVehicle', 'delVehicle', 'saveUser', 'delUser', 'changePassword', 'posDay'];
// คำสั่งจากระบบอื่น (backend แอปขาย GoPMaS Mobile POS) — ยืนยันด้วยกุญแจร่วม INGEST_KEY ใน gas/secret.js (ไม่ขึ้น git)
const KEYED = ['posVehicles', 'posDay'];

// ================= entry =================
function doPost(e) {
  let out, lock;
  try {
    const req = JSON.parse(e.postData.contents);
    const fn = API[req.action] || fail('ไม่รู้จักคำสั่งนี้');
    if (WRITES.includes(req.action)) { lock = LockService.getScriptLock(); lock.waitLock(20000); }
    const user = req.action === 'login' ? null : KEYED.includes(req.action) ? keyAuth(req.key) : auth(req.token);
    out = { ok: true, data: fn(req, user) };
  } catch (err) {
    out = { ok: false, error: err.message, relogin: err.relogin || undefined };
  } finally {
    if (lock) lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return ContentService.createTextOutput('TSM Vehicle API: OK'); }

// รันครั้งแรกจาก editor: อนุญาตสิทธิ์ + สร้างแท็บ/หัวตาราง + ผู้ดูแลคนแรก (ดูรหัสผ่านใน Execution log) — รันซ้ำได้
function setup() {
  const ss = book();
  Object.values(SCHEMA).forEach(({ tab: title, cols }) => {
    const sh = ss.getSheetByName(title) || ss.insertSheet(title);
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(c => c[1])]).setFontWeight('bold').setBackground('#F3EBD6');
    sh.setFrozenRows(1);
    // ponytail: format ข้อความครอบแค่แถวที่มีในชีตตอน setup (ปกติ 1000) — เกินนั้นแถวใหม่ใช้ format แถวก่อนหน้า
    cols.forEach(([, , t], i) => { if (!t) sh.getRange(2, i + 1, sh.getMaxRows() - 1).setNumberFormat('@'); });
  });
  ['ชีต1', 'Sheet1'].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0) ss.deleteSheet(sh);
  });
  secret();
  if (readAll('Users').length) return Logger.log('ตั้งค่าชีตเรียบร้อย');
  const pw = Utilities.getUuid().slice(0, 8);
  append('Users', { username: 'admin', name: 'ผู้ดูแลระบบ', role: 'admin', ...newPw(pw) });
  Logger.log('สร้างผู้ดูแลแล้ว  ชื่อผู้ใช้: admin  รหัสผ่าน: ' + pw + '  (เข้าระบบแล้วเปลี่ยนรหัสผ่านทันที)');
}

// ================= actions =================
const API = {
  login(req) {
    const username = txt(req.username).toLowerCase();
    const cache = CacheService.getScriptCache(), key = 'fail:' + username;
    const fails = Number(cache.get(key) || 0);
    if (fails >= 5) fail('ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
    const user = findUser(username);
    if (!user || hashPw(String(req.password || ''), user.salt) !== user.hash) {
      cache.put(key, String(fails + 1), 900);
      fail('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    cache.remove(key);
    return { token: makeToken(user), ...bootData(user) };
  },

  boot: (req, user) => bootData(user),

  add(req, user) {
    const name = LOGS[req.table] || fail('ประเภทข้อมูลไม่ถูกต้อง');
    const r = req.row || {};
    const plate = myVehicle(user, txt(r.plate)).plate;
    const base = { id: Utilities.getUuid().slice(0, 8), date: date(r.date), plate, note: txt(r.note), by: user.username, at: stamp() };
    let o;
    if (name === 'Usage') {
      o = { ...base, ...usageKm(r), purpose: txt(r.purpose) };
    } else if (name === 'Fuel') {
      o = { ...base, km: num(r.km, 'เลขไมล์'), liters: num(r.liters, 'จำนวนลิตร'), amount: num(r.amount, 'จำนวนเงิน'), station: txt(r.station) };
      if (!(o.liters > 0 && o.amount > 0)) fail('จำนวนลิตรและจำนวนเงินต้องมากกว่า 0');
    } else {
      o = { ...base, kind: KINDS.includes(r.kind) ? r.kind : fail('กรุณาเลือกประเภทงาน'), km: num(r.km, 'เลขไมล์'),
        detail: txt(r.detail, 1000) || fail('กรุณากรอกรายละเอียดงาน'), shop: txt(r.shop), cost: num(r.cost, 'ค่าใช้จ่าย'),
        nextKm: num(r.nextKm, 'เลขไมล์นัดครั้งถัดไป', false) };
      if (o.nextKm !== '' && o.nextKm <= o.km) fail('เลขไมล์นัดครั้งถัดไปต้องมากกว่าเลขไมล์ปัจจุบัน');
    }
    append(name, o);
    return o;
  },

  list(req, user) {
    const name = LOGS[req.table] || fail('ประเภทข้อมูลไม่ถูกต้อง');
    const plates = new Set(myVehicles(user).map(v => v.plate));
    return readAll(name)
      .filter(r => (isAdmin(user) || plates.has(r.plate)) && (!req.plate || r.plate === req.plate) && (!req.month || r.date.startsWith(req.month)))
      .sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at))
      .slice(0, 300).map(strip);
  },

  del(req, user) {
    const name = LOGS[req.table] || fail('ประเภทข้อมูลไม่ถูกต้อง');
    const r = readAll(name).find(x => x.id === req.id) || fail('ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)');
    // ประวัติต้องตรวจย้อนหลังได้ตามแนว TSM: พนักงานลบได้แค่รายการของตัวเองที่บันทึกวันนี้ (พิมพ์ผิด) ที่เหลือให้ผู้ดูแลลบ
    if (!isAdmin(user) && (r.by !== user.username || r.at.slice(0, 10) !== today())) {
      fail('ลบได้เฉพาะรายการของตัวเองที่บันทึกวันนี้ ถ้าต้องการแก้รายการเก่าให้แจ้งผู้ดูแล');
    }
    remove(name, r);
    return true;
  },

  dashboard(req, user) {
    const month = /^\d{4}-\d{2}$/.test(req.month) ? req.month : today().slice(0, 7);
    const vs = myVehicles(user), plates = new Set(vs.map(v => v.plate));
    const L = logs(), km = mileage(L), t = today();
    const of = (rows, plate, m) => rows.filter(r => (plate ? r.plate === plate : plates.has(r.plate)) && (!m || r.date.startsWith(m)));

    const vehicles = vs.map(v => {
      const u = of(L.Usage, v.plate, month), f = of(L.Fuel, v.plate, month), rp = of(L.Repairs, v.plate, month);
      const distance = sum(u, 'distance'), liters = sum(f, 'liters');
      return { plate: v.plate, name: v.name, lastKm: km[v.plate] || 0, trips: u.length, distance, liters,
        fuel: sum(f, 'amount'), repair: sum(rp, 'cost'), kmPerL: liters ? round(distance / liters) : null,
        ...service(L, v.plate) };
    }).sort((a, b) => (b.fuel + b.repair) - (a.fuel + a.repair));

    const trend = [-5, -4, -3, -2, -1, 0].map(k => shiftMonth(month, k)).map(m => ({
      month: m, fuel: sum(of(L.Fuel, null, m), 'amount'), repair: sum(of(L.Repairs, null, m), 'cost'),
      distance: sum(of(L.Usage, null, m), 'distance') }));

    const days = d => Math.round((Date.parse(d) - Date.parse(t)) / 864e5);
    const due = (d, what) => { const n = days(d); return n < 0 ? what + 'หมดอายุแล้ว ' + -n + ' วัน' : what + 'จะหมดอายุในอีก ' + n + ' วัน'; };
    const alerts = [];
    vs.forEach(v => {
      if (v.taxExpire && days(v.taxExpire) <= ALERT_DAYS) alerts.push({ level: days(v.taxExpire) < 0 ? 'danger' : 'warn', title: v.plate, text: due(v.taxExpire, 'ภาษี/พ.ร.บ. ') });
    });
    vehicles.forEach(v => {
      const left = v.nextKm === '' ? null : round(v.nextKm - v.lastKm);
      if (left !== null && left <= SERVICE_WARN_KM) alerts.push({ level: left < 0 ? 'danger' : 'warn', title: v.plate,
        text: left < 0 ? 'เลยกำหนดบำรุงรักษามาแล้ว ' + fmt(-left) + ' กม.' : 'ใกล้ถึงกำหนดบำรุงรักษา อีก ' + fmt(left) + ' กม.' });
    });
    (isAdmin(user) ? readAll('Users') : [user]).forEach(u => {
      if (u.tsmExpire && days(u.tsmExpire) <= ALERT_DAYS) alerts.push({ level: days(u.tsmExpire) < 0 ? 'danger' : 'warn', title: u.name || u.username, text: due(u.tsmExpire, 'ใบรับรอง TSM ') });
    });

    const total = k => round(vehicles.reduce((s, v) => s + v[k], 0));
    return { month, vehicles, trend, alerts: alerts.sort((a, b) => (a.level === 'danger' ? 0 : 1) - (b.level === 'danger' ? 0 : 1)),
      totals: { distance: total('distance'), liters: total('liters'), fuel: total('fuel'), repair: total('repair'), trips: total('trips'), vehicles: vs.length } };
  },

  // ---------- แอปขาย (ยืนยันด้วยกุญแจ) ----------
  posVehicles() {
    const km = mileage(logs());
    return readAll('Vehicles').map(v => ({ plate: v.plate, name: v.name, line: v.line, lastKm: km[v.plate] || 0 }));
  },

  // ปิดวันของสายหนึ่ง → บันทึกการใช้รถ + ค่าน้ำมัน + ค่าแก๊ส · id คงที่ต่อ วัน+สาย จึงส่งซ้ำ/ส่งแก้ไขได้ (เขียนทับ ไม่เพิ่มแถว)
  posDay(req) {
    const d = date(req.date), line = txt(req.line, 30) || fail('ไม่ระบุสาย'), plate = txt(req.plate, 30);
    readAll('Vehicles').some(v => v.plate === plate) || fail('ไม่พบรถทะเบียน ' + plate + ' ในระบบ TSM');
    const by = (req.employees || []).map(e => txt(e, 40)).filter(Boolean).join(', ') || 'แอปขาย';
    const base = { date: d, plate, by, at: stamp(), note: 'แอปขาย สาย ' + line };
    const id = k => ['pos', d, line, k].join('-');
    const has = v => v !== '' && v != null;
    // ตรวจครบทุกส่วนก่อน แล้วค่อยเขียน — ไม่ให้เหลือข้อมูลครึ่งๆ กลางๆ
    const use = has(req.startKm) || has(req.endKm) ? { ...base, id: id('use'), ...usageKm(req), purpose: '' } : null;
    const km = use ? use.endKm : '';
    const fuel = Number(req.fuel) > 0 ? { ...base, id: id('fuel'), km, liters: num(req.liters, 'จำนวนลิตรน้ำมัน'), amount: num(req.fuel, 'ค่าน้ำมัน'), station: 'น้ำมัน' } : null;
    if (fuel && !(fuel.liters > 0)) fail('กรุณากรอกจำนวนลิตรน้ำมัน');
    const gas = Number(req.gas) > 0 ? { ...base, id: id('gas'), km, liters: '', amount: num(req.gas, 'ค่าแก๊ส'), station: 'แก๊ส' } : null;
    upsert('Usage', id('use'), use);
    upsert('Fuel', id('fuel'), fuel);
    upsert('Fuel', id('gas'), gas);
    return { use, fuel, gas };
  },

  changePassword(req, user) {
    if (hashPw(String(req.old || ''), user.salt) !== user.hash) fail('รหัสผ่านเดิมไม่ถูกต้อง');
    const o = { ...user, ...newPw(req.password) };
    update('Users', o);
    return { token: makeToken(o) };
  },

  // ---------- ผู้ดูแล ----------
  saveVehicle(req, user) {
    admin(user);
    const v = req.vehicle || {};
    const plate = txt(v.plate, 30) || fail('กรุณากรอกทะเบียนรถ');
    const old = readAll('Vehicles').find(x => x.plate === plate);
    if (req.isNew && old) fail('มีรถทะเบียนนี้อยู่แล้ว');
    const usernames = readAll('Users').map(u => u.username);
    const o = { ...old, plate, name: txt(v.name), taxExpire: date(v.taxExpire, 'วันหมดอายุภาษี', false),
      staff: (v.staff || []).filter(s => usernames.includes(s)).join(','), note: txt(v.note), line: txt(v.line, 30).toUpperCase() };
    const taken = o.line && readAll('Vehicles').find(x => x.plate !== plate && x.line === o.line);
    if (taken) fail('สาย ' + o.line + ' ผูกกับรถ ' + taken.plate + ' อยู่แล้ว');
    header('Vehicles');  // ชีตที่ setup ไว้ก่อนมีคอลัมน์สาย จะได้หัวคอลัมน์ใหม่เอง
    old ? update('Vehicles', o) : append('Vehicles', o);
    return bootData(user);
  },

  delVehicle(req, user) {
    admin(user);
    remove('Vehicles', readAll('Vehicles').find(x => x.plate === req.plate) || fail('ไม่พบรถทะเบียนนี้'));
    return bootData(user);  // ประวัติของรถคันนี้ยังอยู่ในชีต ผู้ดูแลยังดูย้อนหลังได้
  },

  saveUser(req, user) {
    admin(user);
    const u = req.user || {};
    const username = txt(u.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - อย่างน้อย 3 ตัว');
    const old = findUser(username);
    if (req.isNew && old) fail('มีชื่อผู้ใช้นี้แล้ว');
    const role = u.role === 'admin' ? 'admin' : 'staff';
    if (username === user.username && role !== 'admin') fail('ลดสิทธิ์ผู้ดูแลของตัวเองไม่ได้');
    const o = { ...old, username, name: txt(u.name, 100) || fail('กรุณากรอกชื่อ-สกุล'), role,
      tsmNo: txt(u.tsmNo, 50), tsmExpire: date(u.tsmExpire, 'วันหมดอายุใบรับรอง TSM', false) };
    if (u.password || !old) Object.assign(o, newPw(u.password));
    old ? update('Users', o) : append('Users', o);
    const me = findUser(user.username);
    return { ...bootData(me), token: username === user.username ? makeToken(me) : undefined };
  },

  delUser(req, user) {
    admin(user);
    if (req.username === user.username) fail('ลบบัญชีของตัวเองไม่ได้');
    const u = findUser(req.username) || fail('ไม่พบผู้ใช้นี้');
    readAll('Vehicles').forEach(v => {
      const s = staffOf(v);
      if (s.includes(u.username)) update('Vehicles', { ...v, staff: s.filter(x => x !== u.username).join(',') });
    });
    remove('Users', u);
    return bootData(user);
  },
};

function bootData(user) {
  const L = logs(), km = mileage(L), users = readAll('Users');
  return {
    user: pub(user),
    vehicles: myVehicles(user).map(v => ({ ...strip(v), staff: staffOf(v), lastKm: km[v.plate] || 0, ...service(L, v.plate) })),
    names: Object.fromEntries(users.map(u => [u.username, u.name])),
    users: isAdmin(user) ? users.map(pub) : [],
    serviceWarnKm: SERVICE_WARN_KM,
  };
}

// ================= auth =================
const b64 = bytes => Utilities.base64EncodeWebSafe(bytes);
const hmac = (msg, key) => b64(Utilities.computeHmacSha256Signature(msg, key));
// ponytail: HMAC-SHA256 รอบเดียว + salt ต่อคน — พอเมื่อชีตไม่เปิดสาธารณะ; ถ้าต้องเข้มขึ้นให้วนหลายรอบ (key stretching)
const hashPw = (pw, salt) => hmac(pw, salt);
function newPw(pw) {
  pw = String(pw || '');
  if (pw.length < 6) fail('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  const salt = Utilities.getUuid();
  return { salt, hash: hashPw(pw, salt) };
}
function secret() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('SECRET');
  if (!s) p.setProperty('SECRET', s = Utilities.getUuid() + Utilities.getUuid());
  return s;
}
// โทเคน = base64(username|หมดอายุ).ลายเซ็น — ลายเซ็นผูกกับ hash รหัสผ่าน: เปลี่ยนรหัสหรือลบผู้ใช้ โทเคนเก่าใช้ไม่ได้ทันที
const tokenSig = (payload, user) => hmac(payload + '|' + user.hash, secret());
function makeToken(user) {
  const payload = user.username + '|' + (Date.now() + TOKEN_DAYS * 864e5);
  return b64(Utilities.newBlob(payload).getBytes()) + '.' + tokenSig(payload, user);
}
function auth(token) {
  const [body, sig] = String(token || '').split('.');
  let payload = '';
  try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(body)).getDataAsString(); } catch (e) { /* โทเคนเสีย */ }
  const [username, exp] = payload.split('|');
  const user = findUser(username);
  if (!user || !sig || Date.now() > Number(exp) || tokenSig(payload, user) !== sig) {
    const e = new Error('กรุณาเข้าสู่ระบบใหม่');
    e.relogin = true;
    throw e;
  }
  return user;
}
function keyAuth(key) {
  const k = typeof INGEST_KEY === 'undefined' ? '' : INGEST_KEY;
  if (!k || key !== k) fail('ไม่มีสิทธิ์');
  return { username: '', role: 'pos' };
}
const pub = u => ({ username: u.username, name: u.name, role: u.role, tsmNo: u.tsmNo, tsmExpire: u.tsmExpire });
const findUser = username => readAll('Users').find(u => u.username === username);
const isAdmin = u => u.role === 'admin';
const admin = u => isAdmin(u) || fail('เฉพาะผู้ดูแลระบบเท่านั้น');
const staffOf = v => String(v.staff || '').split(',').map(s => s.trim()).filter(Boolean);
const myVehicles = user => readAll('Vehicles').filter(v => isAdmin(user) || staffOf(v).includes(user.username));
const myVehicle = (user, plate) => myVehicles(user).find(v => v.plate === plate) || fail('ไม่มีสิทธิ์บันทึกข้อมูลรถทะเบียนนี้');

// ================= sheet =================
let _book, _tz;
const book = () => _book || (_book = SpreadsheetApp.openById(SHEET_ID));
const tz = () => _tz || (_tz = book().getSpreadsheetTimeZone());
const tab = name => book().getSheetByName(SCHEMA[name].tab);

// ponytail: อ่านทั้งแท็บทุกครั้ง — สบายๆ ถึงหลักหมื่นแถว; ถ้าช้าค่อยแยกชีตรายปีหรือ cache ผลรวม
function readAll(name) {
  const sh = tab(name), cols = SCHEMA[name].cols, n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, cols.length).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach(([k, , t], j) => {
      const v = r[j];
      o[k] = t === 'd' ? (v instanceof Date ? Utilities.formatDate(v, tz(), 'yyyy-MM-dd') : String(v))
        : t === 'n' ? (v === '' ? '' : Number(v))
        : String(v).replace(/^'(?=[=+\-@])/, '');
    });
    return o;
  });
}
// ข้อความที่ขึ้นต้นด้วย = + - @ ใส่ ' นำหน้า กันชีตตีความเป็นสูตร
const toRow = (name, o) => SCHEMA[name].cols.map(([k, , t]) => {
  const v = o[k] == null ? '' : o[k];
  return !t && /^[=+\-@]/.test(v) ? "'" + v : v;
});
const append = (name, o) => tab(name).appendRow(toRow(name, o));
const update = (name, o) => tab(name).getRange(o._row, 1, 1, SCHEMA[name].cols.length).setValues([toRow(name, o)]);
const remove = (name, o) => tab(name).deleteRow(o._row);
const strip = ({ _row, ...o }) => o;
const header = name => tab(name).getRange(1, 1, 1, SCHEMA[name].cols.length).setValues([SCHEMA[name].cols.map(c => c[1])]);
function upsert(name, id, o) {
  const old = readAll(name).find(r => r.id === id);
  if (old && o) update(name, { ...o, _row: old._row });
  else if (old) remove(name, old);
  else if (o) append(name, o);
}
const logs = () => ({ Usage: readAll('Usage'), Fuel: readAll('Fuel'), Repairs: readAll('Repairs') });
// รอบบำรุงรักษา = งาน "บำรุงรักษา" ครั้งล่าสุด: ทำที่เลขไมล์ไหน นัดครั้งถัดไปที่เลขไมล์ไหน
function service(L, plate) {
  const r = L.Repairs.filter(x => x.plate === plate && x.kind === KINDS[0]).sort(byDate).pop();
  return { serviceKm: r ? r.km : '', nextKm: r ? r.nextKm : '' };
}
function mileage(L) {  // เลขไมล์ล่าสุดของแต่ละคัน = ค่าสูงสุดที่เคยบันทึก
  const m = {};
  const bump = (p, km) => { if (km !== '' && km > (m[p] || 0)) m[p] = km; };
  L.Usage.forEach(r => bump(r.plate, r.endKm));
  L.Fuel.forEach(r => bump(r.plate, r.km));
  L.Repairs.forEach(r => bump(r.plate, r.km));
  return m;
}

// ================= utils =================
function fail(msg) { throw new Error(msg); }
const round = n => Math.round(n * 100) / 100;
const sum = (rows, k) => round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
const fmt = n => Number(n).toLocaleString('en-US');
const byDate = (a, b) => (a.date + a.at).localeCompare(b.date + b.at);
const today = () => Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd');
const stamp = () => Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd HH:mm');
const txt = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
function num(v, label, required = true) {
  if (v === '' || v == null) return required ? fail('กรุณากรอก' + label) : '';
  const n = Number(v);
  if (!isFinite(n) || n < 0) fail(label + 'ไม่ถูกต้อง');
  return round(n);
}
function usageKm(r) {
  const startKm = num(r.startKm, 'เลขไมล์เริ่มต้น'), endKm = num(r.endKm, 'เลขไมล์สิ้นสุด');
  if (endKm < startKm) fail('เลขไมล์สิ้นสุดต้องไม่น้อยกว่าเลขไมล์เริ่มต้น');
  if (endKm - startKm > 3000) fail('ระยะทางเกิน 3,000 กม. ในครั้งเดียว กรุณาตรวจเลขไมล์อีกครั้ง');
  return { startKm, endKm, distance: round(endKm - startKm) };
}
function date(v, label = 'วันที่', required = true) {
  v = txt(v);
  if (!v) return required ? fail('กรุณาระบุ' + label) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) fail(label + 'ไม่ถูกต้อง');
  return v;
}
function shiftMonth(ym, k) {
  const i = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5)) - 1 + k;
  return Math.floor(i / 12) + '-' + String(i % 12 + 1).padStart(2, '0');
}
