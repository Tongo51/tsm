// dev: เปิดหน้าแอปขาย (C:\gopmas_supper_salesman\app) กับ backend จำลอง — ไม่แตะระบบจริง
// node dev/pos-stub.js → http://localhost:8788 (ตั้ง pos.cfg.url = http://localhost:8788/api ใน localStorage)
const fs = require('fs'), path = require('path'), http = require('http');
const app = 'C:/gopmas_supper_salesman/app', posted = [];
const data = {
  vehicles: { ok: true, data: [{ plate: '70-1234', name: 'อีซูซุ 6 ล้อ', line: 'L1', lastKm: 87185 }, { plate: 'ผก 4521', name: 'รีโว่', line: '', lastKm: 44149 }] },
  roster: { ok: true, employees: [{ name: 'ต้น', line: 'L1' }, { name: 'เอ', line: 'L1' }], lines: ['L1'] },
  master: { ok: true, products: [{ id: 'หลอดใหญ่', name: 'หลอดใหญ่', price: 40 }], customers: [] },
};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api') {
    let body = ''; req.on('data', c => body += c);
    return req.on('end', () => {
      if (body) posted.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data[u.searchParams.get('action')] || { ok: true }));
    });
  }
  if (u.pathname === '/posted') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(posted)); }
  const f = path.join(app, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8788, () => console.log('pos stub: http://localhost:8788'));
