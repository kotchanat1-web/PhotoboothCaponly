# ISSUES — Photobooth

## ⚠️ ข้อควรระวังถาวร (ห้ามลบ)
- [ISS-001] ก่อนเริ่มงานโค้ดบนเครื่องใหม่ ตรวจ `node -v` และ `git --version` ก่อนเสมอ
- [ISS-002] หลัง `npm install` ใหม่ (หรือลบ node_modules) ต้องรัน `node node_modules/electron/install.js` และตรวจ `npx electron --version` ก่อนรันแอป

---

### ISS-002 | `npm install` ไม่ได้ดาวน์โหลดไฟล์โปรแกรม Electron
- พบเมื่อ: 2026-11-19
- อาการ: หลัง `npm install` ไม่มีโฟลเดอร์ `app/node_modules/electron/dist` → รันแอปไม่ได้
- วิธีทำให้เกิดซ้ำ: ลบ `app/node_modules` แล้ว `npm install` (npm 11.20, Node v26.13.1, electron 45.4.1) แล้ว `ls node_modules/electron/dist`
- สาเหตุ: `node_modules/electron/package.json` ไม่มี install script ที่ npm จะรันให้ (ตรวจแล้ว) — ไฟล์โปรแกรมต้องดาวน์โหลดผ่าน `install.js` ของแพ็กเกจ electron เอง; npm รุ่นนี้ยังเตือนเรื่อง install scripts ที่ไม่ได้อนุมัติ (`electron-winstaller`) *(อนุมาน: ระบบ install-scripts ของ npm 11 เกี่ยวข้อง)*
- วิธีแก้: รัน `node node_modules/electron/install.js` ใน `app/` → `npx electron --version` ได้ `v45.4.1` (CHG-003)
- สถานะ: ✅ แก้แล้ว (วิธีแก้แบบ manual — ยังไม่ได้ทำเป็น script อัตโนมัติ)
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
