# CHANGELOG — Photobooth

> รายการใหม่อยู่บนสุด (RULES หัวข้อ 11)

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
