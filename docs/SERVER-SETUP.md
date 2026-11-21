# ตั้ง server ตรวจการจ่ายเงิน (Cloudflare Workers + Omise) — DEC-018, DEC-019

```
ลูกค้าสแกน QR ──► ธนาคาร ──► Omise ──webhook (ลายเซ็น HMAC)──► server (Cloudflare Worker)
                                    ▲                              │ 1) ตรวจลายเซ็น
                                    └──── GET /charges/{id} ───────┤ 2) ดึง charge จาก Omise ซ้ำ
                                                                   │ 3) ยอด/สกุลเงิน/id ตรง → successful
ตู้ ◄── WebSocket "charge X เปลี่ยน" ──────────────────────────────┘
ตู้ ──► GET /v1/charges/X (ถามสถานะที่ server ยืนยันแล้ว) ──► ปลดล็อกการถ่าย
```
- ตู้ **ไม่มี** Omise key และไม่คุยกับ Omise เลย — มีแค่ booth key ของตัวเอง
- ราคาอยู่บน server (ตาราง `prices`) — ตู้ส่งแค่จำนวนใบ; ถ้าราคาในตู้ไม่ตรง server ปฏิเสธ (409)
- webhook หาย → ตู้ถาม server ทุก 3 วินาที (server ไปถาม Omise ให้ ไม่เกินทุก 5 วินาที/รายการ) + cron ทุก 1 นาที
- **PromptPay ยกเลิก/คืนเงินผ่าน Omise ไม่ได้** → ถ้าเงินเข้าหลังตู้ยกเลิก server บันทึก `paid_after_cancel` และรายการขึ้นใน `GET /v1/charges/unclaimed` (ตู้ log `payment.unclaimed` ตอนเปิดโปรแกรม) → เจ้าหน้าที่ชดเชยเอง

> ⏳ ยังไม่ได้ทดสอบกับ Cloudflare / Omise จริง — ทดสอบแล้วบนเครื่องด้วย `wrangler dev` + Omise จำลอง (`scripts/mock-omise.mjs`)

---

## ก. ทดสอบบนเครื่อง (ไม่ต้องมีบัญชี)
ใน `server/`:
```
npm install
npm test                                   # 25 ข้อ
```
สร้าง `server/.dev.vars` (ไม่ขึ้น git) — ค่าทดสอบเท่านั้น:
```
OMISE_SECRET_KEY=skey_test_localmock
OMISE_WEBHOOK_SECRET=<Base64 อะไรก็ได้ เช่นจาก: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
OMISE_API_BASE=http://127.0.0.1:8790
```
```
npx wrangler d1 migrations apply photobooth --local
node scripts/add-booth.mjs local1 "Dev booth" --local          # พิมพ์ boothId/boothKey ครั้งเดียว
```
เปิด 2 หน้าต่าง:
```
# 1) Omise จำลอง (PowerShell: $env:MOCK_WEBHOOK_SECRET="<ค่าเดียวกับใน .dev.vars>")
node scripts/mock-omise.mjs
# 2) server
npx wrangler dev --local --port 8787 --test-scheduled
```
`app/config/local.json`:
```json
{ "payment": { "provider": "server", "server": { "baseUrl": "http://127.0.0.1:8787", "boothId": "local1", "boothKey": "<จาก add-booth>" } } }
```
จ่ายเงินจำลอง: ดู id ที่ `http://127.0.0.1:8790/_test/charges` แล้ว `POST http://127.0.0.1:8790/_test/pay/<chrg id>` (เพิ่ม `?webhook=0` เพื่อทดสอบกรณี webhook หาย)

---

## ข. ขึ้นใช้งานจริง (User ทำเอง — ห้ามส่ง key ในแชท)
1. สมัคร Cloudflare (ฟรี) → ใน `server/`: `npx wrangler login`
2. สร้างฐานข้อมูล: `npx wrangler d1 create photobooth` → คัดลอก `database_id` ไปแทน `00000000-…` ใน `server/wrangler.jsonc` (commit ได้ ไม่ใช่ความลับ)
3. `npx wrangler d1 migrations apply photobooth --remote`
4. สมัคร Omise → อีเมล support@omise.co ขอเปิด PromptPay (เอกสาร Omise ระบุให้ทำ) → ใช้ **test key** ก่อน
5. `npx wrangler deploy` → ได้ URL เช่น `https://photobooth-payments.<ชื่อบัญชี>.workers.dev`
6. Omise dashboard (test) → Webhooks → ใส่ `https://photobooth-payments.<ชื่อบัญชี>.workers.dev/webhooks/omise` → คัดลอก webhook secret
7. ใส่ความลับ (ระบบจะถามให้วางค่า):
   ```
   npx wrangler secret put OMISE_SECRET_KEY        # skey_test_…
   npx wrangler secret put OMISE_WEBHOOK_SECRET    # secret จากข้อ 6
   ```
8. ลงทะเบียนตู้: `node scripts/add-booth.mjs booth1 "ตู้หน้าร้าน" --remote` → ใส่ผลใน `%APPDATA%\photobooth\local.json` ของตู้ พร้อม `"baseUrl": "https://photobooth-payments.<ชื่อบัญชี>.workers.dev"`
9. ทดสอบ: ตู้ → เลือก 1 ใบ → QR ขึ้น → Omise dashboard (test) → Charges → charge ล่าสุด → Actions → **Mark as Successful** → ตู้ต้องไปหน้าเลือกกรอบ
10. ใช้จริง: เปลี่ยนข้อ 6–7 เป็น live key / live webhook

## ราคา
แก้บน server (ไม่ต้อง deploy ใหม่) แล้วแก้ `prices` ใน config ของตู้ให้ตรงกัน (ตู้แสดงราคาจาก config ของตัวเอง; ถ้าไม่ตรง server จะไม่สร้าง QR):
```
npx wrangler d1 execute photobooth --remote --command "UPDATE prices SET amount_satang = 15000 WHERE qty = 1"
```

## ดูรายการที่ต้องชดเชย / ประวัติ
```
npx wrangler d1 execute photobooth --remote --command "SELECT id, booth_id, session_id, amount_satang, paid_at, cancel_requested_at FROM charges WHERE status='successful' AND claimed_at IS NULL"
npx wrangler d1 execute photobooth --remote --command "SELECT * FROM audit ORDER BY id DESC LIMIT 50"
```
หน้า dashboard สำหรับเรื่องนี้ = ADM-2 (M4)

## ข้อจำกัดที่รู้ (จากเอกสาร Omise 2026-11-20)
- QR หมดอายุตาม `QR_EXPIRY_SEC` (ค่าเริ่มต้น 120 วินาที) — Omise ให้ตั้งได้ไม่เกิน 24 ชม.; ไม่มี event ตอน PromptPay หมดอายุ → cron ปิดรายการเองหลัง `LATE_GRACE_SEC` (900 วินาที)
- Omise ไม่รับประกันการส่ง webhook ซ้ำ → มี cron + การถามจากตู้
- รูป QR ดาวน์โหลดจาก `download_uri` ด้วย secret key — ยังไม่ได้ตรวจกับ Omise จริงว่าต้องใช้ key หรือไม่ *(อนุมาน)*
- บุคคลธรรมดาสมัคร Omise + PromptPay ได้หรือไม่ — เอกสารไม่ระบุ
