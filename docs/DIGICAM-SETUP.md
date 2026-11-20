# ตั้งกล้อง DSLR ผ่าน digiCamControl (DEC-016)

ใช้เมื่อต้องการให้แอปตั้ง **shutter speed / F (รูรับแสง) / ISO / White balance** และถ่ายรูปความละเอียดเต็มจากกล้อง (CAM-1)
— โหมด webcam (docs/WEBCAM-SETUP.md) ตั้งค่าพวกนี้ไม่ได้

> ⏳ **ยังไม่ได้ทดสอบกับกล้องจริง** — ทดสอบแล้วเฉพาะ unit test (เซิร์ฟเวอร์จำลอง) และกรณี "ไม่ได้เปิด digiCamControl" ในแอปจริง
> API อ้างอิงจากซอร์สโค้ด digiCamControl (`WebServerModule.cs`, `CommandLineProcessor.cs` บน GitHub branch master — อาจต่างจาก 2.1.7 เล็กน้อย)

## 1. ติดตั้ง (ครั้งเดียว)
1. ติดตั้ง **digiCamControl Stable 2.1.7** จาก digicamcontrol.com/download (ตัว "Virtual Webcam" ไม่ต้องลง)
2. **ปิด EOS Webcam Utility** ถ้ามี — สองโปรแกรมใช้กล้องพร้อมกันไม่ได้ *(อนุมาน)*
3. ตั้งกล้อง: โหมด **M** (ถ้าจะให้แอปตั้ง shutter + F), คุณภาพรูป **JPEG** (ถ้าตั้ง RAW แอปจะแจ้ง error "set image quality to JPEG")
4. เสียบ USB → เปิด digiCamControl → ต้องเห็นชื่อกล้องในโปรแกรม
5. digiCamControl → **Settings → Webserver**: ติ๊ก **Use web server** และ **Allow interaction via web server** → ปิด/เปิดโปรแกรมใหม่ (เอกสารของ digiCamControl ระบุว่าต้อง restart)
6. ทดสอบในเบราว์เซอร์บนเครื่องตู้: `http://127.0.0.1:5513/?slc=get&param1=shutterspeed&param2=` → ต้องได้ค่าเช่น `1/125`

## 2. ดูค่าที่กล้องรองรับ
เปิดในเบราว์เซอร์ (ได้ 1 ค่าต่อบรรทัด) — **ต้องใช้ค่าตามนี้เป๊ะๆ** ใน config:
```
http://127.0.0.1:5513/?slc=list&param1=shutterspeed&param2=
http://127.0.0.1:5513/?slc=list&param1=aperture&param2=
http://127.0.0.1:5513/?slc=list&param1=iso&param2=
http://127.0.0.1:5513/?slc=list&param1=whitebalance&param2=
```
รูปแบบค่าที่คาดไว้ (จากซอร์สโค้ด): shutter `1/125` หรือ `30s`, F `5.6` (ไม่มี `f/`), ISO `200`

## 3. ตั้งค่าแอป
`local.json` (dev: `app/config/local.json`, ตู้: `%APPDATA%\photobooth\local.json`):
```json
{
  "camera": {
    "driver": "digicam",
    "digicam": {
      "baseUrl": "http://127.0.0.1:5513",
      "exposure": { "shutterspeed": "1/125", "aperture": "5.6", "iso": "200", "whitebalance": "" }
    }
  }
}
```
- ค่าว่าง `""` = ไม่แตะ ใช้ค่าที่ตั้งไว้บนตัวกล้อง
- แอปส่งค่าเหล่านี้ไปที่กล้องทุกครั้งที่ลูกค้าแตะเริ่ม (ขั้นตรวจกล้อง ก่อนจ่ายเงิน) และอ่านค่าจริงกลับมาบันทึกใน log `camera.ready` → `exposure`
- ถ้าค่าไม่ถูกต้อง: ตู้ขึ้น "ตู้ยังไม่พร้อม" (ไม่ให้จ่ายเงิน — BR-01) และ log `device.not_ready` จะบอกค่าที่กล้องรองรับ
- ยังไม่มีหน้าแอดมินสำหรับปรับค่า — ADM-1 (M4)

## 4. ตรวจผล
| log | ความหมาย |
|---|---|
| `camera.ready` + `exposure` | เชื่อมต่อได้ และค่าที่ตั้งจริงบนกล้อง |
| `device.not_ready` … `web server not reachable` | ยังไม่เปิด digiCamControl หรือยังไม่เปิด web server |
| `device.not_ready` … `no camera in digiCamControl` | เปิดโปรแกรมแล้ว แต่ไม่เห็นกล้อง |
| `capture.failed` … `did not appear within` | สั่งถ่ายแล้วไม่ได้ไฟล์ใน 20 วินาที (`camera.digicam.captureTimeoutMs`) |

Live view: แอปขอ `?CMD=LiveViewWnd_Show` แล้วดึงภาพจาก `/liveview.jpg` (ผ่าน `booth://liveview/frame.jpg`) — ถ้าจอ live view ดำ ให้ลองเปิด Live View ในหน้าต่าง digiCamControl เอง แล้วแจ้งผล
