# HANDOFF — อัปเดตล่าสุด 2026-11-19

## สถานะปัจจุบัน
- **M1-1 เสร็จ (CHG-003)** — แอป Electron ใน `app/` เดินครบ flow ทั้งโหมด kiosk และ event ด้วยไดรเวอร์จำลอง (กล้อง/ปริ้นเตอร์/payment/รีเลย์)
- PRD v1.2, DEC-001..010
- Business rules (PRD หัวข้อ 4) ยังเป็นร่างเสนอ BR-01..07 — ยังไม่ล็อก 🔒 (โค้ดทำตามร่างไว้แล้ว: BR-01, BR-02, BR-05, BR-06)

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
- ข้อมูล session อยู่ที่ `~/Library/Application Support/photobooth/sessions/<sessionId>/` (session.json + captures/NN.jpg), log อยู่ที่ `.../photobooth/logs/`

## ทำเสร็จรอบล่าสุด
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
1. User ยืนยันพฤติกรรม 1–6 ข้างบน
2. M1-2: นำเข้า template.xml + ประกอบรูป 600dpi + printer mock — ต้องได้ไฟล์ `Templates\` จากตู้เดิม และเสนอ DEC เรื่อง image library
3. M1-3: ตรวจ SDK กล้อง Canon/Nikon/Fuji จากเอกสารจริง → DEC → ไดรเวอร์จริง
4. M1-4: DNP DS-RX1 + รีเลย์ serial
5. User พิจารณาล็อก BR-01..07, ตอบรายละเอียดโหมด Event (PRD หัวข้อ 9 ข้อ 8)

## เรื่องที่รอ User ตัดสินใจ
- พฤติกรรม 1–6 ข้างบน
- BR-01..07, โหมด Event, PRD หัวข้อ 9 ข้อ 3–7, กล้อง Sony (out of scope?)

## สิ่งที่ AI รอบหน้าต้องรู้
- RULES อยู่ที่ `docs/RULES.md` (User แก้เท่านั้น); ต้นฉบับ As-Is อยู่ที่ `docs/archive/PRD-v1.0-original.md` (ห้ามแก้)
- โครงโค้ด: state machine อยู่ที่ `app/src/main/machine.ts` — ทุกงาน async ตรวจ `epoch` เพื่อกันผลที่มาช้าหลังเปลี่ยน state; ไดรเวอร์ใหม่ต้อง implement interface ใน `app/src/main/drivers/*/index.ts`
- กล้อง mock/webcam ได้ภาพจาก live view ในหน้า UI ผ่าน RPC `camera:grab` (`app/src/main/rpc.ts`) — ไดรเวอร์ DSLR จริงจะได้ภาพจากกล้องโดยตรง
- ทดสอบ UI อัตโนมัติ: ใช้ `NODE_OPTIONS=--require <hook>` + รันไบนารี `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .` (hook ต้อง `require('electron')` ใน `setImmediate`) — สคริปต์ที่ใช้รอบนี้ไม่ได้เก็บใน repo
- Node v26.13.1, npm 11.20.0, Electron 45.4.1, TypeScript 7.0.2, Vite 8, Vitest 5
- ข้อมูลเรื่อง Omise และ SDK กล้องใน DEC-004/DEC-006 ยังไม่ได้ตรวจกับเอกสารจริง
