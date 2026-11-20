# ISSUES — Photobooth

## ⚠️ ข้อควรระวังถาวร (ห้ามลบ)
- [ISS-001] ก่อนเริ่มงานโค้ดบนเครื่องใหม่ ตรวจ `node -v` และ `git --version` ก่อนเสมอ
- [ISS-002] หลัง `npm install` ใหม่ (หรือลบ node_modules) ต้องรัน `node node_modules/electron/install.js` และตรวจ `npx electron --version` ก่อนรันแอป
- [ISS-007] แก้ `app/src/renderer/src/liveview.tsx` ต้องทดสอบ webcam จริงบน Windows รวมกรณี stream หลุดกลางทาง
- [ISS-004] ห้ามเขียน path ไฟล์แบบ `/` ตายตัว หรือตัด path ด้วย `split('/')` ทั้งในโค้ดและ test — ใช้ `node:path` (`join`/`resolve`/`basename`) และรัน `npm test` บน Windows ก่อน commit เมื่อแก้ส่วนที่เกี่ยวกับ path

---

### ISS-007 | webcam (W1) ถ่ายไม่ได้ "webcam has no frame yet" ทั้งที่ตรวจกล้องผ่าน
- พบเมื่อ: 2026-11-20 (Windows, Integrated Camera 13d3:56ff, `camera.driver = webcam`, `npm run dev`)
- อาการ: `camera.ready` 1280×720 ผ่านตอน CheckDevices → เลือกกรอบ `2x6-02` → `capture.failed` attempt 0 และ 1 "webcam has no frame yet" → `CAPTURE_FAILED` (paid=true, payment mock) → หน้า Error
- วิธีทำให้เกิดซ้ำ: `app/config/local.json` = `{ "camera": { "driver": "webcam" } }` → `npm run dev` → เล่น flow kiosk จนถึงถ่ายช็อตแรก
- สาเหตุ: ยังไม่ทราบ — (ตรวจแล้ว) error มาจาก `activeGrabber` ใน `app/src/renderer/src/liveview.tsx` ~บรรทัด 192 เมื่อ `video.videoWidth` = 0; ค่านี้เป็น 0 ได้เมื่อ `closeWebcam()` ถูกเรียก (track `ended` หรือ state Idle) ซึ่งตั้ง `video.srcObject = null`; LiveView เปิด stream ซ้ำเฉพาะตอน mount *(อนุมาน: track ถูกปิดระหว่าง CheckDevices กับ Countdown — ต้องดู console ของ renderer)*
- ตรวจเพิ่ม: ทำซ้ำไม่ได้ (2 รอบผ่าน CDP ด้วยจังหวะเวลาเดียวกับ log เดิม) *(อนุมาน: ช่วงนั้นมีโปรแกรมอื่นแย่งกล้อง — User กำลังติดตั้ง/เปิดโปรแกรมอื่น — ทำให้ track ended แล้ว stream ถูกปิด)*
- วิธีแก้: (CHG-009) ก่อนถ่าย `ensureWebcamFrame()` เปิดกล้องใหม่ถ้า stream หลุด + รอเฟรมสูงสุด 3 วินาที; live view เปิดใหม่เองทุก 2 วินาทีถ้าหลุด; error บอกสาเหตุ ("webcam stream ended …") — ทดสอบโดยปิด stream ระหว่างนับถอยหลัง → ยังถ่ายได้
- สถานะ: ✅ แก้แล้ว (แก้ตามอาการ — สาเหตุต้นทางยังเป็นการอนุมาน)
- ⚠️ ข้อควรระวัง: ทดสอบซ้ำบน Windows ด้วย webcam จริงทุกครั้งที่แก้ `liveview.tsx`; ถ้าเจออีก ให้ดู error ว่ามีคำว่า "stream ended" หรือไม่
- Keywords: webcam, liveview, no frame, videoWidth, capture.failed, Windows, Integrated Camera

### ISS-006 | `local.json` ที่ JSON ผิดรูปแบบ ทำให้แอปขึ้น dialog "A JavaScript error occurred in the main process"
- พบเมื่อ: 2026-11-20 (ตอนทดสอบ installer — AI เขียน `local.json` ผิดเอง เพราะ backslash ใน path หาย)
- อาการ: เปิดแอปแล้วขึ้น dialog error ของ Electron `SyntaxError: Bad escaped character in JSON` จาก `loadConfig`; ไม่มี log บอกสาเหตุ แอปไม่ทำงาน
- วิธีทำให้เกิดซ้ำ: ใส่ `{ "paths": { "templatesDir": "D:\AI" } }` (backslash เดี่ยว) ใน `%APPDATA%\photobooth\local.json` แล้วเปิด `Photobooth.exe`
- สาเหตุ: (ตรวจแล้ว) `loadConfig` (`app/src/main/config.ts`) เรียก `JSON.parse` โดยไม่ดักข้อผิดพลาด
- วิธีแก้: ยังไม่แก้ — ข้อเสนอ: ดัก error แล้ว log `config.invalid` + แสดงหน้า "ตั้งค่าไม่ถูกต้อง ติดต่อเจ้าหน้าที่"; ระหว่างนี้ใน local.json ให้ใช้ `/` ใน path ของ Windows (เช่น `D:/Photobooth/Templates`) หรือ `\`
- สถานะ: 🔴 เปิด (รอ User อนุมัติแผนแก้)
- ⚠️ ข้อควรระวัง: เวลาเขียน path Windows ใน JSON ต้องใช้ `/` หรือ `\`
- Keywords: local.json, config, JSON, crash, dialog, path, backslash

### ISS-005 | แอปจาก installer เปิดแล้วหยุด เพราะหา Templates ไม่เจอ ถ้าไม่ได้ตั้ง `paths.templatesDir`
- พบเมื่อ: 2026-11-20 (ทดสอบ `dist\win-unpacked\Photobooth.exe`)
- อาการ: log `templates.loaded` count 0 → `app.start_failed` "no visible templates to offer"
- วิธีทำให้เกิดซ้ำ: build `npm run dist:win` แล้วเปิดแอปโดยไม่มี `%APPDATA%\photobooth\local.json`
- สาเหตุ: (ตรวจแล้ว) ค่าเริ่มต้นคือ `<app.asar>/../Templates` = `resources\Templates` ซึ่งไม่ได้ถูกรวมใน installer — ตรงกับที่ออกแบบไว้ (DEC-014: "บนตู้ตั้ง `paths.templatesDir`") แต่ยังไม่มีขั้นตอนติดตั้งที่บอกเรื่องนี้ และหน้าจอไม่บอกสาเหตุ
- วิธีแก้: ยังไม่แก้ — ชั่วคราว: สร้าง `%APPDATA%\photobooth\local.json` = `{ "paths": { "templatesDir": "D:/.../Templates" } }` → ทดสอบแล้วโหลด 21/19 และเข้าหน้า SelectPayment ได้; ทางเลือกถาวร (รอ User): รวม `Templates/` ใน installer ผ่าน `extraResources` หรือเขียนคู่มือติดตั้ง
- สถานะ: 🔴 เปิด (รอ User เลือกวิธี)
- ⚠️ ข้อควรระวัง: ติดตั้งบนตู้ใหม่ต้องตั้ง `paths.templatesDir` ก่อน
- Keywords: installer, electron-builder, Templates, templatesDir, packaged, start_failed

### ISS-004 | unit test 1 ข้อล้มบน Windows เพราะเขียน path แบบ `/` ไว้ตายตัว
- พบเมื่อ: 2026-11-20 (รัน `npm test` ครั้งแรกบนเครื่อง Windows)
- อาการ: 97/98 — `tests/machine.test.ts` > "kiosk mode — happy path" คาดว่าได้ `/tmp/S1/captures/01.jpg` แต่ได้ `\tmp\S1\captures\01.jpg`
- วิธีทำให้เกิดซ้ำ: บน Windows รัน `npm test` ใน `app/` ด้วยโค้ดที่ commit `772d04b`
- สาเหตุ: (ตรวจแล้ว) โค้ดแอปสร้าง path ด้วย `path.join` จึงได้ `\` บน Windows ซึ่งถูกต้อง แต่ test ตัด path ด้วย `split('/')` และเทียบกับ string `/tmp/...` ตายตัว — **โค้ดแอปไม่ผิด**; ตรวจ `src/` แล้ว ไม่มีจุดอื่นที่ตัด path ไฟล์ด้วย `/` (มีแค่ `u.pathname` ของ URL `booth://` ใน `src/main/index.ts` ซึ่งถูกต้อง)
- วิธีแก้: ใน test ใช้ `basename()` และ `join()` จาก `node:path` แทน string ตายตัว (CHG-008)
- สถานะ: ✅ แก้แล้ว (98/98 บน Windows; ยังไม่ได้รันซ้ำบน Mac — ผลบน Mac ควรเหมือนเดิมเพราะ `join` ได้ `/`)
- ⚠️ ข้อควรระวัง: ห้ามเขียน path ไฟล์แบบ `/` ตายตัวใน test/โค้ด ใช้ `node:path` และรัน test บน Windows
- Keywords: windows, path, separator, backslash, test, join, basename

### ISS-003 | log ของ UI event ชื่อ event ถูกเขียนทับ + log ถี่เกินไป
- พบเมื่อ: 2026-11-19 (จาก log ที่ User รัน `npm run dev`)
- อาการ: บรรทัด log แสดง `"event":"TOUCH"`, `"event":"ACTIVITY"` แทน `"event":"ui.event"`; และมีบรรทัด ACTIVITY ทุกครั้งที่แตะจอ
- วิธีทำให้เกิดซ้ำ: `npm run dev` แล้วแตะหน้าจอใดก็ได้ ดู log ใน Terminal
- สาเหตุ: (ตรวจแล้ว) `app/src/main/machine.ts` ใน `dispatch()` ส่ง `{ event: ev.type }` เป็น data และ `FileLogger.log()` (`app/src/main/logger.ts`) ใส่ `...data` หลัง `event` ทำให้ key ชนกันและถูกเขียนทับ; ACTIVITY ถูก log ทุกครั้ง ขัดกับ PRD NFR Logging "ลด noise"
- วิธีแก้: เปลี่ยนชื่อ key เป็น `ui` และไม่ log ACTIVITY (`machine.ts`); เพิ่ม `formatLogLine()` ให้ ts/level/event ไม่ถูก data ทับ (`logger.ts`) (CHG-004)
- สถานะ: ✅ แก้แล้ว
- ⚠️ ข้อควรระวัง: ถ้าแก้ logger ต้องรัน unit test + ตรวจ log จริงว่ายังเป็น JSON บรรทัดละรายการ
- Keywords: log, logger, ui.event, ACTIVITY, noise

### ISS-002 | `npm install` ไม่ได้ดาวน์โหลดไฟล์โปรแกรม Electron
- พบเมื่อ: 2026-11-19
- อาการ: หลัง `npm install` ไม่มีโฟลเดอร์ `app/node_modules/electron/dist` → รันแอปไม่ได้
- วิธีทำให้เกิดซ้ำ: ลบ `app/node_modules` แล้ว `npm install` (npm 11.20, Node v26.13.1, electron 45.4.1) แล้ว `ls node_modules/electron/dist`
- สาเหตุ: `node_modules/electron/package.json` ไม่มี install script ที่ npm จะรันให้ (ตรวจแล้ว) — ไฟล์โปรแกรมต้องดาวน์โหลดผ่าน `install.js` ของแพ็กเกจ electron เอง; npm รุ่นนี้ยังเตือนเรื่อง install scripts ที่ไม่ได้อนุมัติ (`electron-winstaller`) *(อนุมาน: ระบบ install-scripts ของ npm 11 เกี่ยวข้อง)*
- วิธีแก้: รัน `node node_modules/electron/install.js` ใน `app/` → `npx electron --version` ได้ `v45.4.1` (CHG-003)
- สถานะ: ✅ แก้แล้ว (วิธีแก้แบบ manual — ยังไม่ได้ทำเป็น script อัตโนมัติ)
- อัปเดต 2026-11-20: เกิดซ้ำบน Windows (Node v22.23.2, npm 12.0.2) — ไม่มี `node_modules/electron/dist` หลัง `npm install`; แก้ด้วยวิธีเดิมได้ `v45.4.1` (CHG-008); npm ยังบล็อก install script ของ `electron-winstaller@5.4.0`
- ⚠️ ข้อควรระวัง: ทุกครั้งที่ติดตั้ง dependency ใหม่ ให้ตรวจว่ามี `node_modules/electron/dist`; `electron-winstaller` (ใช้ตอนทำ installer Windows) ยังไม่ได้อนุมัติ install script — ต้องตรวจตอนทำ `npm run dist:win`
- Keywords: electron, npm install, binary, dist, install-scripts

### ISS-001 | เครื่องพัฒนา (Mac) ยังไม่มี Node.js และ Xcode Command Line Tools
- พบเมื่อ: 2026-11-19
- อาการ: `node`, `npm` ไม่พบ; เรียก `python3` แล้วขึ้น "No developer tools were found, requesting install"; `/usr/bin/git` เป็นเพียง shim ที่ต้องใช้ Xcode CLT
- วิธีทำให้เกิดซ้ำ: รัน `which node npm` และ `python3 --version` ใน Terminal
- สาเหตุ: ยังไม่ได้ติดตั้งเครื่องมือ (ตรวจแล้ว)
- วิธีแก้: User ติดตั้งเอง — `xcode-select --install` และ Node.js LTS จาก nodejs.org (AI ไม่ติดตั้งให้ เพราะเป็นการแก้ระบบเครื่อง)
- สถานะ: ✅ แก้แล้ว — อัปเดต 2026-11-19: Xcode CLT (`git version 2.39.5`) และ Node.js `v26.13.1` / npm `11.20.0` ใช้ได้ (CHG-003)
- ⚠️ ข้อควรระวัง: ก่อนเริ่มงานที่เขียนโค้ด ต้องตรวจ `node -v` และ `git --version` ก่อน
- Keywords: node, npm, git, xcode, เครื่องมือ, environment
