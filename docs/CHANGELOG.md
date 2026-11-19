# CHANGELOG — Photobooth

> รายการใหม่อยู่บนสุด (RULES หัวข้อ 11)

### CHG-003 | 2026-11-19 | M1-1 ส่วนที่ 2: โครงแอป Electron + state machine + mock drivers + UI
- คำขอ: แผน M1-1 (อนุมัติแล้ว)
- อ้างอิง: DEC-003..010, ISS-001 (แก้แล้ว), ISS-002 (ใหม่ — แก้แล้ว)
- ไฟล์ที่สร้างใหม่ (ทั้งหมดใน `app/`):
  - `package.json`, `package-lock.json`, `tsconfig.json`, `electron.vite.config.mts`, `vitest.config.mts`
  - `config/default.json` — โหมด, ราคา 130/250/375/500, timeout ต่อหน้า, ไดรเวอร์, กรอบตัวอย่าง 3 แบบ
  - `src/shared/types.ts` — ชื่อ state, Snapshot, UiEvent
  - `src/main/` — `index.ts` (Electron + protocol `booth://` + IPC), `machine.ts` (state machine), `config.ts`, `pricing.ts`, `session.ts` (session.json + captures/), `logger.ts` (JSON log รายวัน, ลบ > 30 วัน), `rpc.ts`
  - `src/main/drivers/` — `camera` (interface + FrameCamera: mock/webcam), `printer` (interface + mock), `payment` (interface + mock), `relay` (interface + frame ตามโปรโตคอลเดิม + mock + none)
  - `src/preload/index.ts`, `src/renderer/` (React: Idle, CheckDevices, DeviceError, SelectPayment, SelectQty, CreatingCharge, WaitPayment, ConfirmCancel, SelectTemplate, Instruction, Countdown/Shooting/Review, ShowQR, Error)
  - `tests/` — `machine.test.ts`, `units.test.ts`, `helpers.ts`
- สิ่งที่เปลี่ยน: แอปเดินครบ flow ทั้งโหมด kiosk และ event ด้วยไดรเวอร์จำลอง
- ผลกระทบ: ไม่มีโค้ดเดิม
- ทดสอบ:
  - `npx vitest run` → 37/37 ผ่าน ✅ (ทุก transition, ราคา 1→130 2→250 3→375 4→500, CAM-8 กล้อง/ปริ้นเตอร์ไม่พร้อม → ไม่เข้าหน้าจ่ายเงิน, CAM-7 power-cycle, PAY-3 ยืนยันยกเลิก, จ่ายระหว่างหน้ายืนยันยกเลิก → นับ, จ่ายหลังยกเลิก → บันทึก orphan, timeout ทุกหน้า, ถ่ายพลาด → retry → Error แบบ paid, relay frame CH2 ON = `333c000000020172`)
  - `tsc --noEmit` ผ่าน ✅, `electron-vite build` ผ่าน ✅
  - รันแอปจริงบน Mac (Electron 45.4.1) ด้วยสคริปต์คลิกอัตโนมัติ: โหมด kiosk ครบ flow (จ่าย 2 ใบ 250 บาท → ยกเลิก → ไม่ยกเลิก → จ่าย (mock) → กรอบ 2×6 → ถ่าย 3 ช็อต → ShowQR → Idle) ✅ ได้ `captures/01..03.jpg` (JPEG 800×1200) + `session.json` status completed/paid; โหมด event ข้ามการจ่ายเงิน ครบ flow ✅ `payment: null`
  - ⏳ ยังไม่ได้ทดสอบ: ไดรเวอร์ `webcam` (ต้องให้ User อนุญาตกล้องบน macOS), โหมดเต็มจอ/kiosk (`window.kiosk`), การทำ installer Windows
- อนุมัติโดย: User

### CHG-002 | 2026-11-19 | M1-1 ส่วนที่ 1: git init + DEC-007..010 + PRD v1.2
- คำขอ: วางแผน M1 → User อนุมัติแผน M1-1
- อ้างอิง: DEC-007, DEC-008, DEC-009, DEC-010, ISS-001
- ไฟล์ที่แก้: `docs/DECISIONS.md`, `docs/PRD.md` (หัวข้อ 8, v1.1 → v1.2), `docs/ISSUES.md` (ISS-001 → 🟡), `docs/HANDOFF.md`
- ไฟล์ที่สร้างใหม่: `.gitignore`, repo git (`git init -b main`, user.name/email ตั้งเฉพาะ repo นี้)
- สิ่งที่เปลี่ยน: commit แรก `2461eca` = เอกสาร CHG-001; บันทึก DEC-007..010
- ผลกระทบ: ไม่มีโค้ด
- ทดสอบ: `git log` แสดง commit แรก ✅; ส่วนโค้ด M1-1 ⏳ ยังไม่เริ่ม — หยุดรอ Node.js (ISS-001) ตามความเสี่ยงที่ระบุในแผน
- อนุมัติโดย: User

### CHG-001 | 2026-11-19 | ตั้งโครงสร้างเอกสาร /docs + PRD v1.1
- คำขอ: จัดเอกสารตาม RULES ระดับ L และบันทึกการตัดสินใจรอบแรก
- อ้างอิง: DEC-001, DEC-002, DEC-003, DEC-004, DEC-005, DEC-006, ISS-001
- ไฟล์ที่แก้/ย้าย:
  - ย้าย `RULES.md` → `docs/RULES.md` (ไม่แก้เนื้อหา)
  - ย้าย `PRD/prd.md` → `docs/archive/PRD-v1.0-original.md` (ไม่แก้เนื้อหา), ลบโฟลเดอร์ `PRD/` ที่ว่างแล้ว
- ไฟล์ที่สร้างใหม่: `docs/PRD.md` (v1.1), `docs/DECISIONS.md`, `docs/CHANGELOG.md`, `docs/ISSUES.md`, `docs/HANDOFF.md`
- สิ่งที่เปลี่ยน: PRD เขียนใหม่ตามแม่แบบภาคผนวก A, เพิ่ม MODE-1..6, PAY-8, PRN-9, แก้ CAM-1/CAM-9/PAY-5; Business rules เป็นร่างเสนอ (ยังไม่ล็อก)
- ผลกระทบ: ตำแหน่งไฟล์เอกสารเปลี่ยน; ยังไม่มีโค้ด
- ทดสอบ:
  - checksum SHA-256 ของ RULES.md และ PRD ต้นฉบับ ก่อน/หลังย้ายตรงกัน ✅
  - requirement ID เดิมทุกตัวยังอยู่ใน PRD v1.1 ✅ (ดูผลใน HANDOFF)
  - git commit: ⏳ ทำไม่ได้ (ISS-001)
  - แก้ไข: commit ได้ภายหลังเป็น `2461eca` (CHG-002)
- อนุมัติโดย: User
