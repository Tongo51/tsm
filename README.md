# สมุดประจำรถ · TSM

เว็บแอปบันทึกการใช้รถ ค่าน้ำมัน และงานซ่อม/บำรุงรักษารถโรงงาน สำหรับพนักงานผู้ควบคุมการใช้รถที่ผ่าน TSM ของกรมการขนส่งทางบก

- หน้าเว็บ: `docs/` (GitHub Pages) → https://tongo51.github.io/tsm/
- Backend: `gas/Code.js` (Google Apps Script web app) เก็บข้อมูลลง Google Sheet "TSM"
- ทดสอบบนเครื่อง: `node dev/server.js test` (ชุดทดสอบ) หรือ `node dev/server.js` แล้วเปิด http://localhost:8787 (ใช้ชีตจำลองในหน่วยความจำ)

## แก้ backend แล้ว deploy ใหม่

```bash
cd gas && clasp push --force && clasp redeploy AKfycbxu0EcH5P0lXWCKOCp64f45jqpwim1EDujU5pHIJBsRcdb300PODpiuY-V2nAHbLD9c
```

ใช้ deployment เดิม URL จึงไม่เปลี่ยน และไม่ต้องแก้ `docs/app.js`
