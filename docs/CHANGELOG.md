# CHANGELOG — Photobooth

> รายการใหม่อยู่บนสุด (RULES หัวข้อ 11)

### CHG-006 | 2026-11-19 | M1-3w: กล้องแบบ webcam (W1 USB webcam + W2 Canon EOS 70D ผ่าน EOS Webcam Utility)
- คำขอ: "W1 W2 ทำเลย" / "ลอง test เป็น webcam ก่อน รองรับระบบ webcam ของ canon EOS 70D ด้วย"
- อ้างอิง: DEC-015, DEC-004, CAM-2, CAM-9
- ไฟล์ที่สร้างใหม่: `app/src/shared/camera.ts` (เลือกกล้องตามชื่อ, หมุน, คำนวณการขยายภาพ), `app/tests/camera.test.ts`, `docs/WEBCAM-SETUP.md`
- ไฟล์ที่แก้: `app/src/renderer/src/liveview.tsx` (stream กล้องตัวเดียวใช้ร่วมกันตั้งแต่ตรวจอุปกรณ์ → live view → ถ่าย, ปิดเมื่อกลับ Idle; เลือกกล้องตาม `deviceLabel`; ขอสูงสุด 4K; หมุนภาพทั้งตอนแสดงและตอนบันทึก; mirror เฉพาะตอนแสดง), `app/src/renderer/src/App.tsx`, `app/src/renderer/src/screens/Capture.tsx`, `app/src/main/machine.ts` (log `camera.ready` + เตือน `capture.low_resolution`), `app/src/main/drivers/camera/index.ts`, `app/src/main/drivers/camera/frameCamera.ts`, `app/src/main/index.ts` (probe timeout 15 วินาที), `app/src/main/config.ts`, `app/config/default.json` (`camera.rotation`, `camera.webcam`), `app/src/shared/types.ts`, docs: DECISIONS (DEC-015), PRD (v1.4), HANDOFF
- ผลกระทบ: หน้าถ่ายรูปใช้ canvas แสดง live view ทั้ง mock และ webcam
- ทดสอบ:
  - `vitest` 98/98 ✅ (+14): เลือกกล้องตามชื่อ / ไม่เจอ → ไม่แอบใช้ตัวอื่น / ไม่เลือกไมค์, หมุน 90/180/270, ตัวอย่างที่รู้คำตอบ (1920×1080 → ช่อง 1030×1530 ต้องขยาย ×1.42; 1080×1920 พอ; 4K พอสำหรับช่อง 1447×1950), config rotation, log camera.ready, เตือนความละเอียด (ไม่บล็อก)
  - `tsc` ✅, `electron-vite build` ✅
  - ❌/⏳ รันกับ webcam ของ Mac: ตรวจกล้องหมดเวลา (`camera:probe timed out`) — macOS camera permission ของ Electron = `not-determined` ต้องให้ User กด "อนุญาต" เอง → **ยังไม่ได้ทดสอบกับกล้องจริง**
  - ⏳ W2 กับ EOS 70D บนตู้ Windows — User ทดสอบตาม docs/WEBCAM-SETUP.md
- อนุมัติโดย: User

### CHG-005 | 2026-11-19 | M1-2: นำเข้ากรอบเดิม + ประกอบรูป 600dpi + พิมพ์ผ่าน mock
- คำขอ: แผน M1-2 (อนุมัติแล้ว)
- อ้างอิง: DEC-011, DEC-012, DEC-013, DEC-014; TPL-1, TPL-3, TPL-6, IMG-3, PRN-4, PRN-8
- ไฟล์ที่สร้างใหม่: `app/src/main/templates.ts`, `app/src/main/compose.ts`, `app/tests/templates.test.ts`, `app/tests/compose.test.ts`, `app/tests/previewMatch.ts`
- ไฟล์ที่แก้: `app/src/main/machine.ts` (state Compose → Print, ใช้กรอบจริง, PRN-8), `app/src/main/index.ts` (โหลดกรอบ, booth://print และ booth://template), `app/src/main/session.ts` (print record, sessionDir), `app/src/main/config.ts` + `app/config/default.json` (ลบกรอบตัวอย่าง, เพิ่ม timeout compose/print, event.printCopies, paths.templatesDir), `app/src/shared/types.ts`, `app/src/renderer/**` (หน้าเลือกกรอบใช้ preview.png, หน้า Compose/Print, ShowQR แสดงรูปประกอบแล้ว), `app/tests/machine.test.ts`, `app/tests/units.test.ts`, `app/tests/helpers.ts`, `app/package.json` (+@napi-rs/canvas)
- commit แยก: `c012d29` เพิ่ม `Templates/` (DEC-014)
- สิ่งที่เปลี่ยน: ถ่ายครบ → ประกอบรูปลงกรอบจริง → พิมพ์ (mock) ตามจำนวนใบ → ShowQR
- ผลกระทบ: flow หลังถ่ายเพิ่ม 2 state; กรอบตัวอย่าง 3 แบบเดิมถูกแทนด้วยกรอบจริง
- ทดสอบ:
  - `vitest` 84/84 ✅ — นำเข้า 21 กรอบไม่มี error, Id ไม่ซ้ำ (XML เดิมซ้ำจริง 3 ชุด), จำนวนช่อง/มุมหมุนตรง XML, กรอบเทศกาลถูกซ่อน, crop แบบ cover ตัวอย่างที่รู้คำตอบ (800×1200 → ช่อง 1030×1530 = 1030×1545, ตัดบน-ล่าง 7.5 px)
  - เทียบตำแหน่งช่องกับ preview.png ของระบบเดิม **ทุกกรอบ**: ทุกช่อง ≥ 0.975 (ต่ำสุด 0.980, ส่วนใหญ่ ≥ 0.99) ✅ — ยืนยันว่าหมุนรอบจุดกลางช่องถูกต้อง (ที่เคยเป็น *(อนุมาน)*)
  - negative control: ไม่หมุน / หมุนกลับทิศ / เลื่อน 30 px → ตรวจจับได้ ✅ — ข้อจำกัด: กรอบที่ overlay อยู่บนรูป การเลื่อนเล็กน้อยที่ถูก overlay บังจะตรวจไม่ได้ (และไม่เห็นในรูปพิมพ์เช่นกัน)
  - ประกอบรูป 4×6 / 2×6 ได้ขนาด 2400×3600 / 1200×3600, ใช้เวลา ~120–130 ms ในแอปจริง (เป้า < 15 วินาที) ✅
  - machine: พิมพ์ = จำนวนใบที่จ่าย (2), event พิมพ์ตาม printCopies, ประกอบรูปพลาด → Error แบบ paid ไม่พิมพ์, พิมพ์พลาด/ค้าง → Error + print status failed เก็บไฟล์ไว้พิมพ์ซ้ำ ✅
  - รันแอปจริงบน Mac: kiosk (กรอบ 2×6-02 มีช่องหมุน, 2 ใบ → mock printer ได้ 2 ไฟล์) และ event (4×6-601 6 ช็อต, 1 ใบ) ครบ flow ✅ พร้อมภาพหน้าจอ
  - แก้ระหว่างทาง: หน้า ShowQR ล้นจอที่หน้าต่าง 1280×720 → จัดรูปกับ QR เป็นแถวเดียว ✅
  - ⏳ ยังไม่ได้ทดสอบ: @napi-rs/canvas บน Windows และใน installer (electron-builder)
- อนุมัติโดย: User

### CHG-004 | 2026-11-19 | แก้ ISS-003: log ชื่อ event ถูกเขียนทับ + ลด noise
- คำขอ: User อนุมัติแผน "แก้ ISS-003"
- อ้างอิง: ISS-003
- ไฟล์ที่แก้: `app/src/main/machine.ts` (`dispatch()`), `app/src/main/logger.ts` (เพิ่ม `formatLogLine()`), `app/tests/units.test.ts` (+2 test)
- สิ่งที่เปลี่ยน: UI event log เป็น `{"event":"ui.event","ui":"TOUCH"}`; ไม่ log ACTIVITY; data ทับ ts/level/event ไม่ได้
- ผลกระทบ: เฉพาะรูปแบบ log — ไม่กระทบ state machine
- ทดสอบ: `vitest` 39/39 ✅, `tsc` ✅; รันแอปจริง (event mode) → log 33 บรรทัด เป็น JSON ถูกต้องทุกบรรทัด, `ui.event` แสดงชื่อถูกต้อง, ACTIVITY 0 บรรทัด ✅
- อนุมัติโดย: User

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
