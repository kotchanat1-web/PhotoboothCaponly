# HANDOFF — อัปเดตล่าสุด 2026-11-21

## สถานะปัจจุบัน
- **M1-1 เสร็จ (CHG-003)** — แอป Electron ใน `app/` เดินครบ flow ทั้งโหมด kiosk และ event ด้วยไดรเวอร์จำลอง (กล้อง/ปริ้นเตอร์/payment/รีเลย์)
- **M1-2 เสร็จ (CHG-005)** — ใช้กรอบจริง 21 แบบจาก `Templates/` (แสดง 19, ซ่อนกรอบเทศกาล 2), ประกอบรูป 600dpi, พิมพ์ผ่าน mock ตามจำนวนใบ
- **M1-3w (CHG-006, CHG-009)** — กล้องแบบ webcam (W1/W2) — W1 ทดสอบกับกล้องโน้ตบุ๊กบน Windows แล้ว ✅; W2 (EOS 70D) ยังไม่ได้ทดสอบ
- **Windows (CHG-008)** — test/typecheck/dev ผ่านบน Windows; installer `npm run dist:win` build ได้ (CHG-009)
- **ถ่ายใหม่ CAM-5 (CHG-009, DEC-017)** — หน้า Review มีปุ่ม "ถ่ายใหม่ (เหลือ N)" / "ใช้รูปนี้" — ทดสอบในแอปแล้ว
- **ไดรเวอร์ digiCamControl (CHG-009, DEC-016)** — ตั้ง shutter/F/ISO/WB จาก config — **ยังไม่ได้ทดสอบกับกล้องจริง** (docs/DIGICAM-SETUP.md)
- **server ตรวจการจ่ายเงิน (CHG-010, DEC-018/019)** — `server/` (Cloudflare Workers + D1) + provider `server` ในตู้ — ทดสอบครบวงจรกับ Omise จำลองแล้ว; **ยังไม่ได้ deploy / ยังไม่มีบัญชี Cloudflare และ Omise**
- PRD v1.6, DEC-001..019
- Business rules (PRD หัวข้อ 4) ยังเป็นร่างเสนอ BR-01..07 — ยังไม่ล็อก 🔒 (โค้ดทำตามร่างไว้แล้ว: BR-01, BR-02, BR-05, BR-06)
- เครื่องพัฒนา Windows ตอนนี้: `app/config/local.json` = `{ "camera": { "driver": "webcam" } }` (User: "ตอนนี้เชื่อมต่อเป็นโหมด webcam ก่อน"); `%APPDATA%\photobooth\local.json` ตั้ง templatesDir สำหรับทดสอบ installer

## Repo
- GitHub (**public**): https://github.com/kotchanat1-web/PhotoboothCaponly — branch `main`
- ไม่อยู่ใน git: `app/config/local.json` (ค่าเฉพาะเครื่อง/secret), `EDSDK/`, `node_modules` — ห้าม commit secret เพราะ repo เป็น public

## วิธีรันบน Windows (เครื่องใหม่)
```
git clone https://github.com/kotchanat1-web/PhotoboothCaponly.git
cd PhotoboothCaponly\app
npm install
node node_modules/electron/install.js   # ISS-002
npm test                                # 114/114 (CHG-009)
npm run dev
```
- ต้องติดตั้ง Node.js LTS (x64) และ Git for Windows ก่อน (เครื่องนี้: Node v22.23.2, npm 12.0.2)
- ข้อมูล session/log บน Windows: `%APPDATA%\photobooth\sessions\`, `%APPDATA%\photobooth\logs\`, ปริ้นเตอร์จำลอง `%APPDATA%\photobooth\mock-printer\`
- ตั้งกล้อง Canon 70D: docs/WEBCAM-SETUP.md

## วิธีรัน (บน Mac)
```
cd app
npm install
node node_modules/electron/install.js   # ISS-002
npm test            # unit test
npm run typecheck
npm run dev         # เปิดแอป
```
- เปลี่ยนโหมด/ค่าเฉพาะเครื่อง: สร้าง `app/config/local.json` (ไม่ขึ้น git) เช่น `{ "mode": "event" }` หรือ `{ "camera": { "driver": "webcam" } }`
- หน้า QR จ่ายเงินมีปุ่ม "DEV: จำลองว่าจ่ายแล้ว" (แสดงเฉพาะ payment provider = mock) หรือตั้ง `payment.mock.autoPaySec`
- ข้อมูล session อยู่ที่ `~/Library/Application Support/photobooth/sessions/<sessionId>/` (session.json + captures/NN.jpg + `<sessionId>-print4x6.jpg|print2x6.jpg`), log อยู่ที่ `.../photobooth/logs/`
- ปริ้นเตอร์จำลองคัดลอกไฟล์ตามจำนวนใบไปที่ `.../photobooth/mock-printer/`

## ทำเสร็จรอบล่าสุด
- CHG-010: server ตรวจการจ่ายเงิน — server test 25/25, ตู้ 128/128, ครบวงจรบนเครื่อง (webhook 0.45 วินาที, webhook หาย 1.3 วินาที, จ่ายหลังยกเลิก → รอชดเชย, server ล่ม → ไม่ให้จ่าย)
- CHG-009: ถ่ายใหม่ (CAM-5), ไดรเวอร์ `digicam` ตั้ง shutter/F/ISO (CAM-1), แก้ ISS-007 (webcam หลุดแล้วถ่ายไม่ได้), ทดสอบ installer — test 114/114; พบ ISS-005 (installer ต้องตั้ง templatesDir), ISS-006 (local.json ผิดรูปแบบ → dialog error) — ยังเปิดอยู่
- CHG-008: ตั้งเครื่อง Windows — ISS-002 เกิดซ้ำ (แก้แบบเดิม), แก้ test ที่เขียน path `/` ตายตัว (ISS-004) → 98/98, รันแอปครบ flow kiosk ได้ไฟล์พิมพ์ 2400×3600
- CHG-007: push ขึ้น GitHub (public) เพื่อย้ายไปทำต่อบน Windows
- CHG-006: webcam W1/W2 — เลือกกล้องตามชื่อ, หมุนตามการติดตั้ง, log ความละเอียด, เตือนเมื่อความละเอียดไม่พอ — test 98/98; คู่มือ docs/WEBCAM-SETUP.md
- ค้นข้อมูล SDK: Canon EDSDK ต้องเป็นนิติบุคคล + อีเมลบริษัท (สมัครไม่ผ่านเพราะใช้ Gmail); wrapper บน GitHub ทุกตัวต้องใช้ EDSDK.dll จาก Canon
- CHG-005 (M1-2): templates.ts, compose.ts, state Compose → Print, หน้าเลือกกรอบใช้ preview.png — test 84/84, เทียบตำแหน่งช่องกับ preview.png ผ่านทุกกรอบ, รันจริงทั้ง 2 โหมด
- CHG-004: แก้ ISS-003 (log ชื่อ event ถูกเขียนทับ + ไม่ log ACTIVITY) — test 39/39
- User รัน `npm run dev` เองบน Mac แล้ว ครบ flow kiosk 4 ช็อต ✅
- CHG-003: โครงแอป, state machine, mock drivers, UI ทุกหน้า, unit test 37 ข้อ, รันจริงบน Mac ทั้ง 2 โหมด
- ISS-001 ปิดแล้ว, ISS-002 (Electron binary ไม่ถูกดาวน์โหลด) แก้แล้วแบบ manual

## พฤติกรรมที่ AI เลือกเองใน M1-1 — รอ User ยืนยัน
1. QR หมดอายุ → ยกเลิก charge → กลับหน้าแรก (PRD PAY-3 เขียนว่า "หมดอายุ/ยกเลิก → ถามยืนยัน" ไม่ชัดว่ากรณีหมดอายุต้องถามไหม หรือให้สร้าง QR ใหม่)
2. โหมด kiosk หลังจ่ายเงินแล้ว: หมดเวลาหน้าเลือกกรอบ → เลือกกรอบที่ไฮไลต์ให้อัตโนมัติ และเริ่มถ่ายเอง (ตาม BR-02 ร่าง) — ไม่กลับหน้าแรก
3. โหมด event: หมดเวลาหน้าเลือกกรอบ → กลับหน้าแรก
4. ถ่ายไม่สำเร็จ → นับถอยหลังใหม่ 1 ครั้ง (`capture.retries`) → ยังพลาด → หน้า Error "ติดต่อเจ้าหน้าที่" + บันทึกใน session.json ว่า paid
5. ปุ่มคูปองแสดงแต่กดไม่ได้ "(เร็วๆ นี้)" — PAY-4 อยู่ M2
6. QR จ่ายเงิน / QR ดาวน์โหลด เป็นกล่องจำลอง — QR จริงต้องเพิ่ม library สร้าง QR (เสนอใน M2/M3)

## งานค้าง (เรียงตามความสำคัญ)
00. **User สมัคร Cloudflare + Omise (ขอเปิด PromptPay) แล้วทำตาม docs/SERVER-SETUP.md ข้อ ข.** — จากนั้นทดสอบด้วย Omise test mode ("Mark as Successful") และตรวจ: รูป QR จาก `download_uri` ใช้ได้จริง, ลายเซ็น webhook จริงผ่าน
0. **ทดสอบ digiCamControl กับกล้องจริง** ตาม docs/DIGICAM-SETUP.md — ส่ง log `camera.ready` (มี `exposure`) และผลการถ่าย; ตรวจว่า live view ขึ้นไหม และรูปแบบค่าที่ `?slc=list` ส่งกลับ
1. ทดสอบ W2 (EOS 70D + EOS Webcam Utility) ตาม docs/WEBCAM-SETUP.md
2. ISS-005 / ISS-006 — User เลือกวิธีแก้ (รวม Templates ใน installer หรือเขียนคู่มือ; ดัก config ผิดแล้วแสดงหน้าจอแทน dialog)
3. User ยืนยันพฤติกรรม 1–6 (ด้านล่าง)
4. หน้าแอดมินในตู้ (ADM-1) — ปรับ shutter/F/ISO, ทดสอบกล้อง ฯลฯ โดยไม่ต้องแก้ local.json
5. M1-4: DNP DS-RX1 + รีเลย์ serial — รวม print_2_per_page (PRN-3) และ PrintToSecondaryPrinter (PRN-7)
6. รัน test ซ้ำบน Mac
7. User พิจารณาล็อก BR-01..07, ตอบรายละเอียดโหมด Event (PRD หัวข้อ 9 ข้อ 8)

## เรื่องที่รอ User ตัดสินใจ
- ISS-005 (แนะนำ A: รวม Templates ใน installer) / ISS-006 (แนะนำ B: หยุด + แสดงหน้า "ตั้งค่าไม่ถูกต้อง") — ถามไว้แล้ว User เลือกทำเรื่องการเงินก่อน
- คูปอง (PAY-4) จะตรวจบน server เดียวกันไหม
- พฤติกรรม 1–6 ข้างบน
- ISS-005 (Templates ใน installer), ISS-006 (config ผิดรูปแบบ)
- ค่า retake (DEC-017: 1 ครั้ง/ช็อต, Review 8 วินาที) — ปรับได้ใน config ถ้าต้องการค่าอื่น
- BR-01..07, โหมด Event, PRD หัวข้อ 9 ข้อ 3–7, กล้อง Sony (out of scope?)

## สิ่งที่ AI รอบหน้าต้องรู้
- RULES อยู่ที่ `docs/RULES.md` (User แก้เท่านั้น); ต้นฉบับ As-Is อยู่ที่ `docs/archive/PRD-v1.0-original.md` (ห้ามแก้)
- โครงโค้ด: state machine อยู่ที่ `app/src/main/machine.ts` — ทุกงาน async ตรวจ `epoch` เพื่อกันผลที่มาช้าหลังเปลี่ยน state; ไดรเวอร์ใหม่ต้อง implement interface ใน `app/src/main/drivers/*/index.ts`
- กรอบ: `app/src/main/templates.ts` (อ่าน XML), `app/src/main/compose.ts` (ประกอบรูป); test `app/tests/compose.test.ts` เทียบกับ preview.png ของระบบเดิม — ถ้าแก้ compose ต้องผ่าน test นี้
- กล้อง mock/webcam ได้ภาพจาก live view ในหน้า UI ผ่าน RPC `camera:grab` (`app/src/main/rpc.ts`) — ไดรเวอร์ DSLR จริงจะได้ภาพจากกล้องโดยตรง
- ทดสอบ UI อัตโนมัติ: ใช้ `NODE_OPTIONS=--require <hook>` + รันไบนารี `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .` (hook ต้อง `require('electron')` ใน `setImmediate`) — สคริปต์ที่ใช้รอบนี้ไม่ได้เก็บใน repo
- Node v26.13.1, npm 11.20.0, Electron 45.4.1, TypeScript 7.0.2, Vite 8, Vitest 5
- ข้อมูลเรื่อง Omise ใน DEC-006 ยังไม่ได้ตรวจกับเอกสารจริง; SDK กล้องตรวจแล้ว (ดู DEC-015, PRD หัวข้อ 9 ข้อ 9)
- โฟลเดอร์ `EDSDK/` (ไฟล์ .pas Delphi ลิขสิทธิ์ Canon ที่ User ได้มา ไม่มี DLL) อยู่ใน repo แต่ **ยังไม่ commit** — แนะนำไม่ใส่ git, รอ User ตัดสินใจ
- เขียน path ไฟล์ด้วย `node:path` เสมอ ห้าม `/` ตายตัว (ISS-004) — ตอนนี้พัฒนาบนทั้ง Mac และ Windows
- server: `server/` แยก package (vitest 5 + `@cloudflare/vitest-plugin`); `npm test` ใน server/ รันใน Workers runtime จำลอง; ทดสอบครบวงจรบนเครื่อง: `scripts/mock-omise.mjs` + `wrangler dev` (ขั้นตอนใน docs/SERVER-SETUP.md ข้อ ก.); `server/.dev.vars` และ D1 local (`server/.wrangler/`) อยู่บนเครื่องนี้ ไม่ขึ้น git — ตู้ทดสอบ `local1` ลงทะเบียนใน D1 local แล้ว (key ไม่ได้เก็บไว้ — ถ้าจะใช้อีก ให้ `add-booth` ใหม่)
- กล้อง digicam: `app/src/main/drivers/camera/digicam.ts` — คุยกับ digiCamControl web server (port 5513, `?slc=...`); API ตรวจจากซอร์สโค้ด master ไม่ใช่ tag 2.1.7; live view ผ่าน `booth://liveview/frame.jpg`
- ทดสอบ UI อัตโนมัติบน Windows: `npx electron-vite dev --remoteDebuggingPort 9223` แล้วสั่ง `window.booth.send(...)` ผ่าน Chrome DevTools Protocol (สคริปต์ไม่ได้เก็บใน repo); ใน dev เรียกฟังก์ชันใน renderer ได้ด้วย `import('/src/liveview.tsx')`
- กล้อง webcam: stream เปิดตอน CheckDevices (RPC `camera:probe`) และปิดเมื่อ Idle (`closeWebcam` ใน App.tsx)
