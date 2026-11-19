# HANDOFF — อัปเดตล่าสุด 2026-11-19

## สถานะปัจจุบัน
- ยังไม่มีโค้ด — มีเอกสารใน `/docs` และ git repo (branch `main`)
- PRD v1.2, DEC-001..010 ยืนยันโดย User แล้ว
- แผน M1 แบ่งเป็น 4 งาน (อนุมัติแผน M1-1 แล้ว):
  - **M1-1** โครง Electron + state machine 2 โหมด + interface/mock ของ camera/printer/payment/relay + UI flow — **กำลังทำ: หยุดรอ Node.js**
  - M1-2 นำเข้า template.xml + ประกอบรูป 600dpi + printer mock (ต้องใช้ไฟล์ Templates เดิมจาก User; เสนอ image library เป็น DEC)
  - M1-3 ไดรเวอร์กล้องจริง Canon/Nikon/Fuji (ตรวจ SDK จากเอกสารจริงก่อน → DEC)
  - M1-4 DNP DS-RX1 + รีเลย์ serial (User ทดสอบบนตู้ Windows)
- Business rules (PRD หัวข้อ 4) ยังเป็นร่างเสนอ BR-01..07 — ยังไม่ล็อก 🔒

## ทำเสร็จรอบล่าสุด
- CHG-002: git init + commit แรก `2461eca`, DEC-007..010 (TypeScript, React, electron-vite + electron-builder, Vitest), PRD v1.2

## งานค้าง (เรียงตามความสำคัญ)
1. ISS-001: User ติดตั้ง Node.js LTS (nodejs.org) → ตรวจด้วย `node -v`
2. ทำ M1-1 ส่วนโค้ดต่อตามแผนที่อนุมัติแล้ว (scaffold app/, state machine, mock drivers, UI, unit test, รันบน Mac + screenshot)
3. User พิจารณาล็อก BR-01..07
4. User ตอบรายละเอียดโหมด Event (PRD หัวข้อ 9 ข้อ 8) — M1-1 ทำแค่ "ข้ามการจ่ายเงิน"

## เรื่องที่รอ User ตัดสินใจ
- อนุมัติ/แก้ BR-01..07
- โหมด Event: จ่ายเงินไหม, จำกัดจำนวนใบไหม, ใช้แบบไม่มีบอร์ดรีเลย์ได้ไหม
- PRD หัวข้อ 9 ข้อ 3–7
- Out of scope: ยืนยันว่ากล้อง Sony ยังไม่ทำ

## สิ่งที่ AI รอบหน้าต้องรู้
- RULES อยู่ที่ `docs/RULES.md` (User แก้เท่านั้น); ต้นฉบับ As-Is อยู่ที่ `docs/archive/PRD-v1.0-original.md` (ห้ามแก้)
- git: identity ตั้งเฉพาะ repo นี้ (ไม่ได้แตะ global config); commit แยกต่องาน
- ตรวจ `node -v` ก่อนเริ่มงานโค้ด (ISS-001)
- แผน M1-1 ที่อนุมัติ: ไฟล์ secret อยู่ที่ `app/config/local.json` (อยู่ใน .gitignore แล้ว), ค่าเริ่มต้นอยู่ที่ `app/config/default.json`
- ข้อมูลเรื่อง Omise และ SDK กล้องใน DEC-004/DEC-006 ยังไม่ได้ตรวจกับเอกสารจริง
