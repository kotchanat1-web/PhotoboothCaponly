# ISSUES — Photobooth

## ⚠️ ข้อควรระวังถาวร (ห้ามลบ)
- (ยังไม่มี)

---

### ISS-001 | เครื่องพัฒนา (Mac) ยังไม่มี Node.js และ Xcode Command Line Tools
- พบเมื่อ: 2026-11-19
- อาการ: `node`, `npm` ไม่พบ; เรียก `python3` แล้วขึ้น "No developer tools were found, requesting install"; `/usr/bin/git` เป็นเพียง shim ที่ต้องใช้ Xcode CLT
- วิธีทำให้เกิดซ้ำ: รัน `which node npm` และ `python3 --version` ใน Terminal
- สาเหตุ: ยังไม่ได้ติดตั้งเครื่องมือ (ตรวจแล้ว)
- วิธีแก้: User ติดตั้งเอง — `xcode-select --install` และ Node.js LTS จาก nodejs.org (AI ไม่ติดตั้งให้ เพราะเป็นการแก้ระบบเครื่อง)
- สถานะ: 🟡 กำลังแก้ — อัปเดต 2026-11-19: ติดตั้ง Xcode CLT แล้ว (`git version 2.39.5` ใช้ได้, `git init` แล้ว); ยังไม่มี Node.js/npm → งาน M1-1 ส่วนโค้ดหยุดรอ
- ⚠️ ข้อควรระวัง: ก่อนเริ่มงานที่เขียนโค้ด ต้องตรวจ `node -v` และ `git --version` ก่อน; ระหว่างที่ยังไม่มี git ให้ถือว่า RULES หัวข้อ 9 (commit แยกต่องาน) ยังทำไม่ได้ และต้องแจ้ง User
- Keywords: node, npm, git, xcode, เครื่องมือ, environment
