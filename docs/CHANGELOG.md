# CHANGELOG — Photobooth

> รายการใหม่อยู่บนสุด (RULES หัวข้อ 11)

### CHG-010 | 2026-11-21 | server ตรวจการจ่ายเงิน (Cloudflare Workers) + ตู้ใช้ provider `server`
- คำขอ: "ให้ทำระบบเช็คเรื่องการเงินให้ดีก่อนโดยเช็คกับทาง gateway ก่อน" → "แบบ A มี server" → Cloudflare Workers → "อนุมัติ"
- อ้างอิง: DEC-018, DEC-019; PAY-1, PAY-2, PAY-3, PAY-7, PAY-8, ADM-7
- ไฟล์ที่สร้างใหม่:
  - `server/` — `src/index.ts` (routes, refresh จาก Omise, reconcile cron), `src/verify.ts` (กติกาเงิน, ลายเซ็น), `src/omise.ts`, `src/hub.ts` (Durable Object WebSocket), `src/env.ts`, `migrations/0001_init.sql`, `wrangler.jsonc`, `vitest.config.mts`, `test/payments.test.ts`, `test/helpers.ts`, `test/setup.ts`, `scripts/add-booth.mjs`, `scripts/mock-omise.mjs` (ทดสอบบนเครื่องเท่านั้น), `package.json`, `tsconfig.json`, `.gitignore`, `worker-configuration.d.ts` (สร้างจาก `wrangler types`)
  - `app/src/main/drivers/payment/server.ts`, `app/tests/payment.test.ts`, `docs/SERVER-SETUP.md`
- ไฟล์ที่แก้: `app/src/main/drivers/payment/index.ts` (`health`, `qty`, `qrImage`, `claim`, `unclaimed`), `app/src/main/machine.ts` (เช็คระบบจ่ายเงินก่อนหน้าจ่ายเงิน, ส่ง qty, claim, log รายการรอชดเชยตอนเริ่ม), `app/src/main/index.ts`, `app/src/main/config.ts` + `app/config/default.json` (`payment.server`), `app/src/shared/types.ts`, `app/src/renderer/src/screens/Payment.tsx` + `styles.css` (QR จริง)
- ผลกระทบ: provider `mock` ยังเป็นค่าเริ่มต้น (เครื่องนี้ยังใช้ mock); โหมด kiosk กับ provider `server` ต้องมีอินเทอร์เน็ตถึงจะรับเงินได้
- ทดสอบ:
  - server `vitest` 25/25 ✅ (Workers runtime + D1 จำลอง): กติกาเงิน (ยอด 12999 / 130 แทน 13000 / สกุลเงิน / id / metadata / paid=false → mismatch), ลายเซ็น (ถูก, 2 ลายเซ็นตอนหมุน secret, body ถูกแก้, secret ผิด, เวลาเก่า), auth ตู้, health (Omise ล่ม → 503), ราคา (1 ใบ = 13000 สตางค์, 2 ใบ = 25000, ราคาไม่ตรง → 409 ไม่เรียก Omise), webhook ลายเซ็นถูกแต่ Omise ยัง pending → ไม่จ่าย, webhook ซ้ำ, สถานะสุดท้ายไม่เปลี่ยน, webhook หาย → poll/cron เจอ, cron ปิดรายการค้าง, จ่ายหลังยกเลิก → unclaimed, ตู้ B ดูรายการตู้ A ไม่ได้, WebSocket push
  - ตู้ `vitest` 128/128 ✅ (+14), `tsc` ✅ ทั้ง app และ server
  - ครบวงจรบนเครื่อง (ตู้จริง + `wrangler dev` + Omise จำลอง ขับผ่าน CDP): จ่าย + webhook → ตู้ปลดล็อก 0.45 วินาที (WebSocket 101 ผ่าน header auth); webhook หาย → 1.3 วินาที (ตู้ถาม server); ยกเลิกแล้วจ่าย → ตู้ `payment.orphan` + server unclaimed (`cancelRequested: true`); เปิดตู้ใหม่ → log `payment.unclaimed` count 1; ปิด server → `PAYMENT_NOT_READY` (เดิมรอ 10 วินาที → ลด timeout health เป็น 5 วินาที)
  - ⏳ **ยังไม่ได้ทดสอบ: Cloudflare จริง, Omise test mode จริง** (ต้องมีบัญชี — docs/SERVER-SETUP.md ข้อ ข.)
- อนุมัติโดย: User

### CHG-009 | 2026-11-20 | ถ่ายใหม่ (CAM-5) + ไดรเวอร์ digiCamControl ตั้ง shutter/F (CAM-1) + แก้ webcam ถ่ายไม่ได้ (ISS-007) + ทดสอบ installer
- คำขอ: "ทำเลย เรื่องการถ่ายถ้าไม่ถูกใจรูป กด cancel แล้วถ่ายใหม่ด้วย อยากให้สามารถเข้าถึงกับตั้ง speed shutter F ของกล้องด้วย" → แผน 1 + 2 → "setup แล้ว ให้เขียนไปก่อน … ตอนนี้เชื่อมต่อเป็นโหมด webcam ก่อน"
- อ้างอิง: DEC-016, DEC-017, ISS-005, ISS-006, ISS-007; CAM-1, CAM-5, CAM-9
- ไฟล์ที่สร้างใหม่: `app/src/main/drivers/camera/digicam.ts`, `app/tests/digicam.test.ts`, `docs/DIGICAM-SETUP.md`
- ไฟล์ที่แก้:
  - retake: `app/src/shared/types.ts` (`ACCEPT_SHOT`, `RETAKE`, `SessionView.retakesLeft`), `app/src/main/machine.ts` (`acceptShot`, `retakeShot`, URL `?r=N` กันรูปเก่าค้าง cache), `app/src/main/session.ts` (`cancelCapture` → `captures_canceled/NN-rK.jpg`), `app/src/main/config.ts` + `app/config/default.json` (`capture.maxRetakes` 1, `timeoutsSec.review` 2 → 8), `app/src/renderer/src/screens/Capture.tsx` (ปุ่ม "ถ่ายใหม่ (เหลือ N)" / "ใช้รูปนี้"), `strings.ts`, `styles.css`
  - digicam: `app/src/main/drivers/camera/index.ts` (`liveViewSource` 'digicam', `CameraStatus.exposure`), `app/src/main/config.ts` + `default.json` (`camera.digicam`, ตรวจ `camera.driver`), `app/src/main/index.ts` (เลือกไดรเวอร์, `booth://liveview/frame.jpg`), `app/src/renderer/src/liveview.tsx` (live view จาก digiCamControl), `app/src/main/machine.ts` (log `camera.ready.exposure`)
  - ISS-007: `app/src/renderer/src/liveview.tsx` (ก่อนถ่ายเปิดกล้องใหม่ถ้า stream หลุด + รอเฟรมสูงสุด 3 วินาที; live view เปิดใหม่ทุก 2 วินาทีถ้าหลุด; error บอกสาเหตุ), `app/src/main/index.ts` (timeout `camera:grab` 5 → 10 วินาที)
  - tests: `app/tests/helpers.ts`, `machine.test.ts` (+5), `units.test.ts` (+2)
- ผลกระทบ: หน้า Review ไม่ข้ามเองใน 2 วินาทีแล้ว (8 วินาที หรือกด "ใช้รูปนี้"); 1 รอบอาจยาวขึ้นสูงสุด ~(8 + 5) วินาทีต่อการถ่ายใหม่ 1 ครั้ง
- ทดสอบ:
  - `vitest` 114/114 ✅ (+16: retake 5, store/config 2, digicam 9 — เซิร์ฟเวอร์จำลอง: ไม่ได้เปิดโปรแกรม, ไม่มีกล้อง, ตั้ง shutter/F/ISO + อ่านกลับ, ค่าไม่ถูกต้อง → บอกค่าที่รองรับ, ถ่าย → ย้ายไฟล์, RAW → error, timeout); `tsc` ✅
  - แอปจริง (Windows, webcam Integrated Camera, ขับผ่าน Chrome DevTools Protocol): กด "ถ่ายใหม่" ช็อต 1 → ได้ `captures_canceled/01-r1.jpg` + รูปใหม่ (`?r=1`); ปิด stream กล้องระหว่างนับถอยหลังช็อต 2 → ยังถ่ายได้; ครบ 3 ช็อต → ShowQR ✅; ปุ่มแสดง "ถ่ายใหม่ (เหลือ 1)", "ใช้รูปนี้ ถ่ายต่อ (8)", ช็อตสุดท้าย "ใช้รูปนี้ (8)" ✅
  - แอปจริงโหมด `digicam` โดยไม่เปิด digiCamControl → DeviceError ก่อนจ่ายเงิน + log บอกวิธีเปิด web server ✅
  - installer: `npm run dist:win` ✅ (`Photobooth Setup 0.1.0.exe` 131 MB, มี `skia.win32-x64-msvc.node` ใน `app.asar.unpacked`); `win-unpacked\Photobooth.exe` + `local.json` ตั้ง templatesDir → โหลด 21/19, เข้า SelectPayment ✅ (พบ ISS-005, ISS-006)
  - ⏳ **ยังไม่ได้ทดสอบ: digiCamControl กับกล้องจริง** — User ทดสอบตาม docs/DIGICAM-SETUP.md แล้วส่ง log `camera.ready` / `capture.failed`
  - ⏳ ยังไม่ได้ทดสอบบน Mac, ยังไม่ได้ติดตั้ง installer ลงเครื่องจริง (ทดสอบแค่ `win-unpacked`)
- อนุมัติโดย: User

### CHG-008 | 2026-11-20 | ตั้งเครื่อง Windows + ทดสอบ test/แอปบน Windows ครั้งแรก
- คำขอ: "เริ่มข้อ ก" (ตั้งเครื่อง Windows ตาม HANDOFF: install → test → dev)
- อ้างอิง: ISS-001, ISS-002, ISS-004, DEC-011 (@napi-rs/canvas บน Windows)
- เครื่อง: Windows 11, Node v22.23.2, npm 12.0.2, git 2.54.0 (Mac ใช้ Node v26.13.1 — รุ่นต่างกัน); repo clone ไว้ที่ `D:\AI Project\PhotoboothCaponly`
- ไฟล์ที่แก้: `app/tests/machine.test.ts` (ใช้ `basename`/`join` จาก `node:path` แทน path `/` ตายตัว — แก้ test เท่านั้น ไม่แตะโค้ดแอป), `docs/ISSUES.md` (ISS-004, อัปเดต ISS-002), `docs/HANDOFF.md`
- ผลกระทบ: ไม่มีต่อโค้ดแอป
- ทดสอบ:
  - `npm install` ✅ (363 packages; ได้ `@napi-rs/canvas-win32-x64-msvc`); ISS-002 เกิดซ้ำ → `node node_modules/electron/install.js` → `npx electron --version` = v45.4.1 ✅
  - `npm test` ก่อนแก้ 97/98 ❌ (ISS-004) → หลังแก้ 98/98 ✅; `npm run typecheck` ✅
  - `npm run dev` (kiosk, ไดรเวอร์ mock) ✅: `templates.loaded` count 21 / visible 19; User กดครบ flow Idle → PromptPay 1 ใบ → จำลองจ่าย → กรอบ `4x6-601` → ถ่าย 6 ช็อต → Compose (~0.15 วินาที) → Print → ShowQR → Idle; ได้ `<sessionId>-print4x6.jpg` 2400×3600 (เปิดดูแล้ว ตรงกรอบ), mock-printer 1 ไฟล์, session.json `paid` 130 / `printed` 1 ใบ; ไม่มี log ระดับ error
  - log `capture.low_resolution` (mock 800×1200, ขยาย ×1.27) เป็นคำเตือนปกติของกล้อง mock
  - ⏳ ยังไม่ได้รันซ้ำบน Mac; ยังไม่ได้ทดสอบ installer (`npm run dist:win`) และ webcam จริง
- อนุมัติโดย: User

### CHG-007 | 2026-11-20 | ขึ้นโค้ดบน GitHub เพื่อย้ายไปทำงานบน Windows
- คำขอ: "ย้ายไปทำใน window" → เลือกวิธี GitHub; User ยืนยันให้ repo เป็น **public** หลังได้รับคำเตือน (ข้อมูลธุรกิจใน PRD, Templates, ชื่อ/อีเมลใน commit)
- อ้างอิง: -
- สิ่งที่เปลี่ยน: เพิ่ม remote `origin` = https://github.com/kotchanat1-web/PhotoboothCaponly.git; push `main` (User ล็อกอินด้วย token เอง — AI ไม่ได้เห็น token)
- ไม่ได้ขึ้น: `EDSDK/` (ไม่อยู่ใน git), `app/config/local.json` (อยู่ใน .gitignore), `node_modules`
- ทดสอบ: `git ls-remote origin` → `refs/heads/main` = `9507a8b` ตรงกับเครื่อง ✅; GitHub API เห็น `.gitignore`, `Templates` (21 โฟลเดอร์), `app`, `docs` ✅
- อนุมัติโดย: User

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
