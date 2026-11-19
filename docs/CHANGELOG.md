# CHANGELOG — Photobooth

> รายการใหม่อยู่บนสุด (RULES หัวข้อ 11)

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
- อนุมัติโดย: User
