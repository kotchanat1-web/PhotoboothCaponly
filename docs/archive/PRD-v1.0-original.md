# PRD — Photobooth (เขียนใหม่ของเราเอง)

> เอกสารนี้สรุปจากการ "ดูอย่างเดียว" ระบบเดิม `C:\PhotoboothQr` (PhotoboothQr v2.22.55 / CameraControl v1.0.70)
> ระบบเดิมไม่มี source code ในเครื่อง ข้อมูลทั้งหมดได้จาก: ไฟล์ config, template, `photobooth.db` (schema + สถิติ), log ใน `C:\PhotoboothQr\logs`, ไฟล์ผลลัพธ์ใน `C:\PhotoboothQr files` และ resource ที่ประกาศใน `PhotoboothQr.xml`
> จุดที่เป็น "การอนุมาน" จะมีเครื่องหมาย *(อนุมาน)* กำกับ

---

## 1. ภาพรวมและเป้าหมาย

ตู้ถ่ายรูปแบบ self-service (kiosk) ใช้กล้อง DSLR Canon ลูกค้าจ่ายเงินเองผ่าน PromptPay QR (หรือใช้คูปอง) เลือกกรอบรูป ถ่ายหลายช็อต เลือกฟิลเตอร์ พิมพ์รูปทันที และสแกน QR เพื่อดาวน์โหลดรูป / วิดีโอ / GIF

**เป้าหมายของการทำใหม่**
1. เป็นเจ้าของโค้ดเองทั้งหมด (ไม่พึ่ง binary ของผู้ขาย / update server ของคนอื่น)
2. ฟีเจอร์เทียบเท่าระบบเดิมที่ใช้งานจริง (ดูหัวข้อ 4)
3. เสถียรกว่าเดิม: กล้องหาย, ปริ้นเตอร์ไม่พร้อม, เน็ตหลุด ต้องกู้คืนเองได้
4. ตั้งค่า / เพิ่มกรอบ / ดูยอดขายได้ง่ายโดยไม่ต้องแก้ไฟล์ด้วยมือ

**ตัวเลขการใช้งานจริงจากระบบเดิม** (`photobooth.db`, ธ.ค. 2025 – พ.ย. 2026)
- 1,060 transactions, 7,940 ไฟล์
- ~91% จ่าย PromptPay 130 บาท / 1 ใบ; มีซื้อ 2 ใบ 250, 3 ใบ 375, 4 ใบ 500 บาท
- ~53 รายการเป็นคูปอง/ฟรี (payment_type_id = 1)
- หน้าจอ 1920×1080 แนวนอน, กล้อง Canon EOS 70D, ปริ้นเตอร์ DNP DS-RX1 (4×6 นิ้ว, 600 dpi)

---

## 2. ระบบเดิมทำงานอย่างไร (As-Is)

### 2.1 ส่วนประกอบ

| ส่วน | ไฟล์ | หน้าที่ |
|---|---|---|
| แอปหลัก (kiosk UI) | `PhotoboothQr.exe` (VB.NET WinForms, .NET 4.8, namespace `dslrBoothQr`) | หน้าจอลูกค้า, ชำระเงิน, ฐานข้อมูล, พิมพ์, อัปโหลด, ควบคุมไฟ/รีเลย์ |
| UI บางหน้า | WebView2 + HTML (`template.html`, resource `template_select_*`, `gbprimepay_qrcode`, `tos`, `privacy`) | หน้าเลือกกรอบ, หน้า QR จ่ายเงิน, ข้อกำหนด/นโยบายความเป็นส่วนตัว |
| โปรแกรมกล้อง | `CameraControl.exe` (Canon EDSDK + OpenCvSharp + ffmpeg) | live view, นับถอยหลัง, ถ่าย, ดาวน์โหลดรูป, อัดวิดีโอสั้นต่อช็อต, ฟิลเตอร์, ประกอบรูปลงกรอบ, สร้าง video |
| การสื่อสารระหว่าง 2 โปรแกรม | command-line args / message (`camera_ready`, `capture_start`, `processing_start2`, `printing_start`, `session_completed`) + Memory-Mapped File (`MMF-OK`) | แจ้งสถานะ step ต่อ step |
| ฐานข้อมูลในเครื่อง | `photobooth.db` (SQLite) | transaction, ไฟล์, เงินสด |
| อัปเดตอัตโนมัติ | `UpdateProgram.exe` | ดาวน์โหลดไฟล์เวอร์ชันใหม่จาก server ผู้ขาย |
| ซิงค์เวลา | `NTPSync.exe` | ตั้งเวลาเครื่องตอนเปิด |
| ล็อกเครื่องเป็น kiosk | `Photobooth.reg` | ปิด edge swipe, ปิด touch hold, ปิด Windows Update |
| เครื่องมือปริ้นเตอร์ | `C:\DNPPIA\PrinterInfo` | เครื่องมือของ DNP ดูสถานะ/กระดาษเหลือ |
| บอร์ดรีเลย์ | Serial `COM3` | เปิด/ปิดไฟตู้และไฟเลี้ยงกล้อง |
| Backend | REST + WebSocket ของผู้ขาย | ตั้งค่าตู้, สร้าง transaction, รับแจ้งจ่ายเงินสำเร็จ, เก็บไฟล์, หน้าดาวน์โหลด |
| Payment gateway | GB Prime Pay (`api.gbprimepay.com/gbp/gateway/qrcode`) | สร้าง PromptPay QR |

### 2.2 Flow การใช้งาน 1 รอบ (จาก log จริง)

```
[Idle / Attract]
   │ แตะหน้าจอ
   ▼
ตรวจกล้อง (EDSDK) ──ไม่เจอ──► ยังเริ่มได้ (จะ power-cycle กล้องทีหลัง)
   │
start_session  → สร้าง sessionId = yyyyMMddHHmmss, transactionUUID 7 ตัวอักษร
               → รีเลย์ CH2 ON (ไฟ "กำลังใช้งาน")
   ▼
เลือกวิธีจ่าย: [PromptPay] / [Coupon]            (timeout ~30s → กลับ Idle)
   │
   ├─ PromptPay → เลือกจำนวนใบ (1–4) → pay start
   │              → สร้าง transaction บน server → ขอ QR (qrcode_request)
   │              → แสดง QR → รอ WebSocket "charge_complete"
   │              → ปุ่ม Back มี dialog ยืนยันยกเลิก (Form3_3 Yes/Back)
   │
   └─ Coupon   → พิมพ์รหัส → ตรวจกับ server ("รหัสไม่ถูกต้อง" ถ้าผิด)
   ▼
จ่ายสำเร็จ → รีเลย์ CH3 ON (ไฟ "จ่ายแล้ว") → บันทึก transaction ในเครื่อง
   ▼
เลือกกรอบ (WebView, template.html: รูปใหญ่ + แถบ thumbnail เลื่อนได้ + ปุ่ม Start)
   ▼
หน้าคำแนะนำ "READY? Smile & look at the camera" (graphics/instruction.png)
   ▼
CameraControl เริ่ม ─ ไม่เจอกล้อง → ปิด/เปิดไฟกล้อง (CH4) แล้วลองใหม่สูงสุดหลายครั้ง
   ▼
วนตามจำนวนช่องในกรอบ (เช่น 4 หรือ 6 ช็อต, ~19 วินาที/ช็อต):
   live view ซ้อนกรอบ (ภาพกลับด้านแบบกระจก) → นับถอยหลัง
   → ระหว่างนับอัดวิดีโอ ~5 วินาที (125 เฟรม @25fps)
   → ถ่ายภาพจริง 3648×5472 → บันทึก captures/NN.jpg
   → แสดงพรีวิวรูปลงกรอบ (CreateTemplate)
   (ถ่ายใหม่ได้: รูปเก่าย้ายไป captures_canceled/NN-<timestamp>.jpg)
   ▼
processing: สร้างพรีวิวฟิลเตอร์ทุกตัว → ลูกค้าเลือกฟิลเตอร์ (HTML grid)
   ▼
printing: ประกอบรูปลงกรอบ → พิมพ์ (หมุนเป็นแนวนอนให้พอดีกระดาษ 6×4)
          กรอบ 2×6: พิมพ์ 2 แถบในกระดาษ 4×6 (print_2_per_page) และ/หรือส่งเข้าปริ้นเตอร์ตัวที่ 2
          → รายงานกระดาษคงเหลือไป server
   ▼
สร้างไฟล์: print4x6.jpg / print2x6.jpg, video.mp4 (วิดีโอสั้นทุกช็อตเรียงในกรอบ 1080×1620, ffmpeg hardware encode AMD), gif.mp4
   ▼
บันทึก session_file + อัปโหลดทุกไฟล์ขึ้น server ทันที
   ▼
หน้า QR ดาวน์โหลด (Form4) → timeout ~2 นาที (next_session_timeout)
   → ปิดไฟ CH3, CH2 → กลับ Idle
```

### 2.3 งานเบื้องหลัง (background jobs)
| งาน | ความถี่ |
|---|---|
| `CheckUploadFile` ส่งไฟล์ค้างอัปโหลดใหม่ | ทุก ~20/40 วินาที |
| `ReportComputerInfo` (heartbeat) | ทุก 5 นาที |
| `checkProgramUpdate` | ทุก 5 นาที |
| `CheckBoothSettings` (ดึงค่าตั้งตู้ด้วย machine_id) | ทุก 5 นาที |
| WebSocket ค้างเชื่อมต่อ | ตลอด, reconnect อัตโนมัติ |
| Printer warm-up / ปลุกปริ้นเตอร์ | ตอนเปิดโปรแกรม และก่อนพิมพ์ |

### 2.4 ข้อมูลและไฟล์

**โฟลเดอร์ต่อ session**: `C:\PhotoboothQr files\<sessionId>\`
```
captures\01.jpg … NN.jpg
captures_canceled\NN-<timestamp>.jpg
<sessionId>-print4x6.jpg  หรือ  -print2x6.jpg
<sessionId>-video.mp4
<sessionId>-gif.mp4
```

**SQLite schema เดิม** (ใช้อ้างอิงได้)
- `payment_transaction`: transaction_id_local, transaction_id_server, transaction_uuid, booth_id, print_qty, payment_price, payment_type_id, print_mode_id, source_id, event_id, camera_id, capture_count, charge_time, end_time, force_upload, upload_status, update_uuid
- `session_file`: file_id_local, transaction_id_local, file_uuid, file_type_id, file_path, create_time, upload_time, file_id_server
- `cash`, `cash_receive`: รองรับรับเงินสด (ยังไม่เคยใช้ — 0 แถว)
- payment_type_id: 4 = PromptPay, 1 = Coupon *(อนุมาน)*, 0 = ทดสอบ *(อนุมาน)*, 8 = Cash (default ของตาราง cash)
- file_type_id: Prints / Video / Gif / Singles *(ลำดับ id อนุมาน)*

**รูปแบบกรอบ (template.xml)** — แต่ละกรอบเป็นโฟลเดอร์ใน `Templates\` มี `template.xml`, รูป overlay `.png`, `preview.png`
```xml
<Template Name Width="2400" Height="3600" Resolution="600" BackgroundColor
          print_2_per_page="True|False" PrintToSecondaryPrinter="True|False" Id>
  <Elements>
    <Image ImagePath="overlay.png" Width Height Top Left ZIndex Opacity .../>
    <Photo PhotoNumber="1" Width Height Top Left Rotation ZIndex KeepAspect .../>
    ...
  </Elements>
</Template>
```
- 4×6 = 2400×3600 px, 2×6 = 1200×3600 px @600dpi
- จำนวน `<Photo>` = จำนวนช็อต (มีกรอบ 1, 3, 4, 6 ช่อง)
- โฟลเดอร์ที่ขึ้นต้นด้วย `.` (เช่น `.2x6-xmas`) = กรอบตามเทศกาล

**ค่าตั้งกล้อง** (`camera_settings.json`): model, shutter 1/200, f/4.5, ISO 1250, WB Color temp 5500K, Large Fine JPEG, Picture Style Portrait, rotation 270 (กล้องตั้งแนวตั้ง), metering, exposure comp

**ค่าตั้งของโปรแกรมกล้อง** (จาก log): liveview FPS 30, record FPS 25, AutoPrint, showThumbnail, displayInstruction, filterEnable, filterLanguage TH, filterTheme dark, liveViewTemplateEnable, flipTemplateEnable, templatePreview, hardwareEncoding, countdown font size/สี/ความโปร่งใส, mobileUpload

**ฟิลเตอร์** (`filter-config.json`): 14 preset (Grayscale, Black and White, High Contrast BW, Negative, Cool Tone, Warm Tone, Sepia, Vintage, Bright, Vivid, Fade, Soft, Cinematic, Film) เปิด/ปิดได้ทีละตัว + รองรับ custom filter

**บอร์ดรีเลย์ (COM3)** — โปรโตคอลจาก log: `33 3C 00 00 00 <CH> <STATE> <CHECKSUM>` (STATE 01=ON, 02=OFF, CHECKSUM = ผลรวมไบต์ก่อนหน้า & 0xFF)
| CH | ใช้ทำอะไร |
|---|---|
| 1 | ไฟตู้ (เปิดตลอด) |
| 2 | ไฟ "มีคนใช้งาน" (เริ่ม session) |
| 3 | ไฟ "จ่ายเงินแล้ว" |
| 4 | ไฟเลี้ยงกล้อง (ใช้ power-cycle เมื่อหากล้องไม่เจอ) |
- `RelayPowerTurnOffSec = 120`

---

## 3. ผู้ใช้งาน

| ผู้ใช้ | ต้องการ |
|---|---|
| ลูกค้า | ใช้ง่าย จ่ายเร็ว ถ่ายสวย ได้รูปทันที ดาวน์โหลดได้ |
| เจ้าของตู้ / แอดมิน | ตั้งราคา, เพิ่ม/ซ่อนกรอบ, ตั้งค่ากล้อง/ฟิลเตอร์, ดูยอดขาย, ดูสถานะตู้จากระยะไกล, ออกคูปอง |
| ช่างดูแล | รู้ทันทีเมื่อกล้อง/ปริ้นเตอร์/กระดาษมีปัญหา, ดู log ได้ |

---

## 4. Functional Requirements (To-Be)

Priority: **P0** = ต้องมีในเวอร์ชันแรก, **P1** = ควรมี, **P2** = ทีหลัง

### 4.1 หน้าจอลูกค้า (Kiosk UI)
| ID | Requirement | P |
|---|---|---|
| UI-1 | เต็มจอ ล็อก kiosk (ไม่มี taskbar, ปิด gesture ขอบจอ, ปิดคลิกขวา) | P0 |
| UI-2 | หน้า Attract/Idle (รูปหรือวิดีโอวน) แตะเพื่อเริ่ม | P0 |
| UI-3 | ทุกหน้ามี timeout กลับหน้าแรกได้ (ตั้งค่าได้ต่อหน้า) พร้อมตัวนับให้ลูกค้าเห็น | P0 |
| UI-4 | รองรับภาษาไทย/อังกฤษ | P1 |
| UI-5 | หน้าข้อกำหนดการใช้งาน (ToS) และนโยบายความเป็นส่วนตัว (PDPA) | P0 |
| UI-6 | ธีม/สี/โลโก้/พื้นหลังเปลี่ยนได้จากการตั้งค่า | P1 |
| UI-7 | ทางเข้าเมนูแอดมินแบบลับ (เช่นกดค้างมุมจอ + PIN) | P0 |

### 4.2 การชำระเงิน
| ID | Requirement | P |
|---|---|---|
| PAY-1 | เลือกจำนวนใบพิมพ์ 1–N พร้อมตารางราคา (เดิม 130/250/375/500) ตั้งค่าได้ | P0 |
| PAY-2 | PromptPay QR ผ่าน payment gateway, รับผลด้วย webhook→WebSocket/push (ไม่ poll) | P0 |
| PAY-3 | QR หมดอายุ / ลูกค้ากดยกเลิก → ถามยืนยัน → ยกเลิก transaction | P0 |
| PAY-4 | คูปอง: กรอกรหัส → ตรวจกับ server (ใช้ได้ครั้งเดียว/จำนวนครั้ง, วันหมดอายุ, ส่วนลดหรือฟรี) | P0 |
| PAY-5 | โหมดฟรี/อีเวนต์ (ไม่ต้องจ่าย) | P1 |
| PAY-6 | เงินสด (เครื่องรับธนบัตร/เหรียญ) — มี schema เดิมรองรับแต่ไม่เคยใช้ | P2 |
| PAY-7 | กันจ่ายซ้ำ/จ่ายแล้วแต่ตู้ไม่รู้: ทุก transaction มี UUID, สถานะ, reconcile กับ server | P0 |

### 4.3 กรอบรูป (Templates)
| ID | Requirement | P |
|---|---|---|
| TPL-1 | หน้าเลือกกรอบ: รูปใหญ่ + thumbnail เลื่อนด้วยการลาก/ปุ่มลูกศร | P0 |
| TPL-2 | รองรับกรอบ 4×6 และ 2×6, ช่องรูป 1–N, overlay PNG, ตำแหน่ง/ขนาด/การหมุนของแต่ละช่อง | P0 |
| TPL-3 | นำเข้า template.xml รูปแบบเดิมได้ (ย้ายกรอบเก่า 21 แบบมาใช้ได้ทันที) | P0 |
| TPL-4 | ซ่อน/แสดงกรอบ, กรอบตามเทศกาล (ช่วงวันที่) | P1 |
| TPL-5 | Editor ลากวางช่องรูปบนหน้าแอดมิน | P2 |
| TPL-6 | Template ID ต้องไม่ซ้ำ (ระบบเดิมมี id ซ้ำหลายกรอบใน template.html) | P0 |

### 4.4 กล้องและการถ่าย
| ID | Requirement | P |
|---|---|---|
| CAM-1 | Canon EDSDK: ค้นหากล้อง, ตั้งค่า (shutter/aperture/ISO/WB/picture style/quality) ตอนเริ่ม | P0 |
| CAM-2 | Live view ≥25fps แสดงซ้อนกรอบ, กลับด้านแบบกระจก (เปิด/ปิดได้), หมุนตามการติดตั้งกล้อง | P0 |
| CAM-3 | นับถอยหลังปรับได้ (วินาที, ขนาด/สีตัวเลข), แสดงช็อตที่ x/N | P0 |
| CAM-4 | ถ่ายภาพจริง → ดาวน์โหลดจากกล้อง → บันทึก `captures/NN.jpg` | P0 |
| CAM-5 | ถ่ายใหม่ (retake) ได้ต่อช็อต จำกัดจำนวนครั้ง, เก็บรูปเดิมไว้ใน `captures_canceled` | P1 |
| CAM-6 | อัดคลิปสั้นจาก live view ระหว่างนับถอยหลัง เพื่อใช้ทำวิดีโอ | P1 |
| CAM-7 | กู้คืนอัตโนมัติ: หากล้องไม่เจอ/หลุด → power-cycle ผ่านรีเลย์ CH4 → retry → ถ้ายังไม่ได้แจ้งแอดมินและไม่ให้เริ่มจ่ายเงิน | P0 |
| CAM-8 | ตรวจสถานะกล้อง **ก่อน** ให้ลูกค้าจ่ายเงิน (ระบบเดิมยอมให้จ่ายก่อนแล้วค่อยแก้กล้อง) | P0 |
| CAM-9 | ออกแบบ camera abstraction ให้รองรับกล้องอื่นภายหลัง (webcam สำหรับทดสอบ, Sony/Nikon) | P1 |

### 4.5 ประมวลผลภาพ
| ID | Requirement | P |
|---|---|---|
| IMG-1 | เลือกฟิลเตอร์หลังถ่าย: แสดงพรีวิวทุกฟิลเตอร์ที่เปิดใช้ (สร้างภายใน < 1 วินาที) | P0 |
| IMG-2 | ฟิลเตอร์ preset 14 แบบตามเดิม + custom (LUT .cube) | P1 |
| IMG-3 | ประกอบรูปลงกรอบความละเอียด 600dpi (crop แบบ cover ตามช่อง, รองรับ rotation, z-index) | P0 |
| IMG-4 | วิดีโอ: นำคลิปของทุกช็อตเล่นพร้อมกันในตำแหน่งช่องของกรอบ → MP4 1080×1620 | P1 |
| IMG-5 | GIF/วิดีโอสั้นแบบสไลด์โชว์จากรูปทุกช็อต | P1 |
| IMG-6 | ใช้ hardware encoder ถ้ามี (AMD/NVIDIA/Intel) ไม่งั้น fallback CPU | P1 |

### 4.6 การพิมพ์
| ID | Requirement | P |
|---|---|---|
| PRN-1 | พิมพ์ไปยัง DNP DS-RX1 ด้วย print settings (DEVMODE) ที่บันทึกไว้ (เทียบ PrintSettings1/2.bin) | P0 |
| PRN-2 | 4×6: หมุนให้ตรงทิศกระดาษ, ชดเชยขอบ (margin offset ปรับได้) | P0 |
| PRN-3 | 2×6: วาง 2 แถบบนกระดาษ 4×6 แล้วตัด (DNP 2-inch cut) | P0 |
| PRN-4 | จำนวนใบ = print_qty ที่ลูกค้าจ่าย | P0 |
| PRN-5 | ตรวจสถานะปริ้นเตอร์ก่อนพิมพ์ + ปลุกปริ้นเตอร์ (warm-up) | P0 |
| PRN-6 | อ่านจำนวนกระดาษคงเหลือจริงจาก DNP (ระบบเดิมส่งค่า 0 เสมอ) และแจ้งเตือนเมื่อใกล้หมด | P1 |
| PRN-7 | รองรับปริ้นเตอร์ตัวที่ 2 (แยกกระดาษ 4×6 / 2×6 หรือกระจายงาน) | P1 |
| PRN-8 | พิมพ์ไม่สำเร็จ → เก็บงานไว้ให้แอดมินสั่งพิมพ์ซ้ำ | P0 |

### 4.7 แชร์/ดาวน์โหลด
| ID | Requirement | P |
|---|---|---|
| SHR-1 | อัปโหลดรูปกรอบ, รูปเดี่ยวทุกช็อต, วิดีโอ, GIF ขึ้น cloud storage | P0 |
| SHR-2 | หน้าแสดง QR ลิงก์ดาวน์โหลด (เว็บหน้า gallery ของ session) | P0 |
| SHR-3 | คิวอัปโหลดแบบ offline-first: เน็ตหลุดก็เก็บไว้ อัปใหม่อัตโนมัติ, ลำดับ: รูปกรอบก่อน | P0 |
| SHR-4 | ลิงก์มีอายุ (เช่น 30 วัน) และลบไฟล์อัตโนมัติตาม PDPA | P1 |

### 4.8 ฮาร์ดแวร์ตู้ (Control board)
| ID | Requirement | P |
|---|---|---|
| HW-1 | ส่งคำสั่งรีเลย์ตามโปรโตคอลเดิม (หัวข้อ 2.4) ผ่าน serial port ตั้งค่าได้ | P0 |
| HW-2 | ผูกไฟกับ state: Idle / Active / Paid / Camera power | P0 |
| HW-3 | ปิดไฟอัตโนมัติหลังไม่มีคนใช้ X วินาที | P1 |

### 4.9 แอดมิน / Backend
| ID | Requirement | P |
|---|---|---|
| ADM-1 | เมนูแอดมินในตู้: ทดสอบกล้อง, ทดสอบพิมพ์, พิมพ์ซ้ำ, ดู log, ปิดโปรแกรม | P0 |
| ADM-2 | Dashboard บนเว็บ: ยอดขายรายวัน/เดือน, จำนวนรอบ, แยกวิธีจ่าย | P1 |
| ADM-3 | ตั้งค่าตู้จากระยะไกล (ราคา, กรอบ, ฟิลเตอร์, timeout) ตู้ดึงค่าด้วย booth id | P1 |
| ADM-4 | Heartbeat สถานะตู้ (กล้อง, ปริ้นเตอร์, กระดาษ, disk, เวอร์ชัน) + แจ้งเตือน (LINE/Telegram) | P1 |
| ADM-5 | จัดการคูปอง (สร้าง, จำนวนครั้ง, วันหมดอายุ, รายงานการใช้) | P0 |
| ADM-6 | อัปเดตโปรแกรมอัตโนมัติจาก server ของเราเอง (มี rollback) | P2 |
| ADM-7 | ระบุตัวเครื่องด้วย device key ที่ลงทะเบียนครั้งแรก (แทน hardware hash) | P1 |

---

## 5. Non-Functional Requirements

| หัวข้อ | เป้าหมาย |
|---|---|
| ความเร็ว | จ่ายเงินสำเร็จ → เริ่ม live view < 5 วินาที; ถ่ายเสร็จ → เริ่มพิมพ์ < 15 วินาที; 1 รอบทั้งหมด ≤ 3 นาที (เดิม ~3 นาที สำหรับ 6 ช็อต) |
| ความเสถียร | ทำงานต่อเนื่อง 16 ชม./วัน ไม่ต้องรีสตาร์ท; crash แล้ว watchdog เปิดใหม่และกู้ session ที่จ่ายแล้วได้ |
| เงินลูกค้า | ทุกการจ่ายที่สำเร็จต้องได้ถ่าย/พิมพ์ หรือมีบันทึกให้ชดเชยได้ |
| Offline | ถ่าย/พิมพ์ได้แม้เน็ตหลุด (ยกเว้นการจ่าย QR) — ไฟล์และ transaction sync ทีหลัง |
| Logging | structured log (JSON) แยกระดับ, หมุนไฟล์รายวัน, ลบอัตโนมัติ > 30 วัน, ไม่ log ข้อมูลส่วนตัว; ลด noise (เดิม log polling ทุก 20 วินาที) |
| Security | API key/secret ไม่ฝังใน binary แบบ plain; payment callback ตรวจ signature; HTTPS ทั้งหมด |
| เวลา | ซิงค์ NTP ตอนเปิด (timestamp ใช้ใน sessionId และ transaction) |
| ความละเอียดจอ | รองรับ 1920×1080 แนวนอน + แนวตั้ง, DPI scaling |

---

## 6. ข้อสังเกต / ปัญหาของระบบเดิมที่ควรแก้

1. **แยก 2 โปรแกรมคุยกันผ่าน argument/MMF** — เปราะบาง, รวมเป็น process เดียวหรือใช้ IPC ที่ชัดเจน (เช่น local WebSocket/gRPC)
2. **ให้จ่ายเงินก่อนตรวจกล้อง** — log มีกรณี "Camera not found - StartSession" แล้วยังให้จ่ายได้
3. **Polling ถี่เกินไป** (CheckUploadFile ทุก 20 วิ, heartbeat ทุก 5 นาที) ทั้งที่มี WebSocket อยู่แล้ว
4. **กระดาษคงเหลือรายงานเป็น 0 ตลอด** — ไม่ได้อ่านค่าจริงจากปริ้นเตอร์
5. **Template ID ซ้ำกัน** ในหน้าเลือกกรอบ (เช่น `Ojd8rawi…` ใช้กับ 4 กรอบ) → เลือกผิดกรอบได้
6. **มี exception ที่ Form3_3 (ObjectDisposed)** ระหว่างยกเลิกการจ่ายเงิน — ต้องจัดการ state การยกเลิกให้ดี
7. ชื่อหน้าจอเป็น Form2_2/Form3_11 ฯลฯ — ฝั่งใหม่ควรเป็น state machine ที่ตั้งชื่อชัดเจน
8. พึ่ง update server และ backend ของผู้ขาย — ต้องย้ายมา backend ของเราเอง (ข้อมูล transaction เดิมใน SQLite export ได้)

---

## 7. สถาปัตยกรรมที่เสนอ (ร่าง — ยังต้องตัดสินใจ)

```
┌─────────────────────────── Kiosk PC (Windows) ───────────────────────────┐
│  UI (Web: React/Svelte ใน WebView2 หรือ Electron/Tauri)                  │
│        ▲ WebSocket/IPC                                                    │
│  Booth Core Service (.NET 8 หรือ Node)                                    │
│   ├─ Session State Machine                                                │
│   ├─ Camera module (Canon EDSDK)  ── live view stream → UI                │
│   ├─ Image pipeline (filters, compositing — SkiaSharp/OpenCV)             │
│   ├─ Video pipeline (ffmpeg)                                              │
│   ├─ Printer module (Win32 print + DNP SDK)                               │
│   ├─ Relay module (Serial)                                                │
│   ├─ Local DB (SQLite) + Upload queue                                     │
│   └─ Watchdog / Logger                                                    │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS + WebSocket
┌──────────────────────────────────▼───────────────────────────────────────┐
│ Backend: API (booth config, transactions, coupons, uploads), Payment      │
│ webhook (GB Prime Pay / อื่น ๆ), Object storage, Gallery page, Dashboard   │
└──────────────────────────────────────────────────────────────────────────┘
```

**State machine หลัก**
`Idle → CheckDevices → SelectPayment → (SelectQty → WaitPayment | EnterCoupon) → Paid → SelectTemplate → Instruction → Capture[1..N] (Countdown → Shoot → Review/Retake) → SelectFilter → Compose → Print → Export/Upload → ShowQR → Idle`
ทุก state มี timeout และ error transition ไปหน้า "ขออภัย กรุณาติดต่อเจ้าหน้าที่" พร้อมบันทึกเหตุผล

---

## 8. Milestones (ร่าง)

| Phase | ขอบเขต |
|---|---|
| M1 — Core offline | State machine, กล้อง Canon (live view + ถ่าย), นำเข้ากรอบเดิม, ประกอบรูป, พิมพ์ DS-RX1, รีเลย์ |
| M2 — Payment | PromptPay QR + webhook, คูปอง, SQLite transaction, กู้ session หลัง crash |
| M3 — Share | อัปโหลด, หน้า gallery + QR, ฟิลเตอร์, วิดีโอ/GIF |
| M4 — Admin | เมนูแอดมินในตู้, dashboard เว็บ, ตั้งค่าระยะไกล, แจ้งเตือน |
| M5 — Polish | auto-update, retake, ปริ้นเตอร์ตัวที่ 2, เงินสด, template editor |

---

## 9. คำถามที่ต้องตัดสินใจ (Open Questions)

1. เทคโนโลยี: .NET 8 (ใกล้ EDSDK/Windows printing) หรือ Electron/Tauri + native module?
2. Payment gateway: ใช้ GB Prime Pay ต่อ (ต้องมีบัญชี merchant ของเราเอง) หรือเปลี่ยน (Omise/2C2P/KBank)?
3. Backend + storage: ทำเอง (เช่น Supabase/Firebase/Cloudflare R2) หรือ self-host?
4. จำนวนตู้ที่จะรัน — 1 ตู้ หรือหลายตู้ (ต้องมี multi-booth ใน dashboard ไหม)?
5. ต้องย้ายข้อมูล transaction เก่า (1,060 รายการ) ไประบบใหม่ไหม?
6. หน้าจอ: คงแนวนอน 1920×1080 หรือจะเปลี่ยนเป็นจอแนวตั้ง?
7. จำนวนช็อตต่อรอบ = จำนวนช่องในกรอบเสมอ หรือให้ถ่ายเกินแล้วเลือกรูป?
