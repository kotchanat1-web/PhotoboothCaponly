import { useEffect, useRef } from 'react'

/** The live view currently on screen registers itself here so main can grab a frame (camera:grab). */
let activeGrabber: (() => Promise<ArrayBuffer>) | null = null

export async function grabFrame(): Promise<ArrayBuffer> {
  if (!activeGrabber) throw new Error('live view not active')
  return activeGrabber()
}

export async function probeWebcam(): Promise<{ ready: boolean; model?: string; error?: string }> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const cam = devices.find((d) => d.kind === 'videoinput')
    return cam ? { ready: true, model: cam.label || 'Webcam' } : { ready: false, error: 'no webcam found' }
  } catch (e) {
    return { ready: false, error: String(e) }
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92)
  )
}

const MOCK_W = 800
const MOCK_H = 1200

function drawMock(ctx: CanvasRenderingContext2D, t: number): void {
  const hue = (t / 40) % 360
  const g = ctx.createLinearGradient(0, 0, MOCK_W, MOCK_H)
  g.addColorStop(0, `hsl(${hue},60%,45%)`)
  g.addColorStop(1, `hsl(${(hue + 80) % 360},60%,25%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, MOCK_W, MOCK_H)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.arc(MOCK_W / 2, MOCK_H * 0.42, 170, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#222'
  ctx.font = 'bold 64px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('MOCK CAMERA', MOCK_W / 2, MOCK_H * 0.78)
  ctx.font = '40px monospace'
  ctx.fillStyle = '#fff'
  ctx.fillText(new Date().toLocaleTimeString(), MOCK_W / 2, MOCK_H * 0.86)
}

export function LiveView({ source, mirror }: { source: 'mock' | 'webcam'; mirror: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let raf = 0
    let stream: MediaStream | null = null
    let stopped = false

    if (source === 'mock') {
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      const loop = (t: number) => {
        drawMock(ctx, t)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      activeGrabber = () => canvasToJpeg(canvas)
    } else {
      navigator.mediaDevices
        .getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        .then((s) => {
          if (stopped) return s.getTracks().forEach((tr) => tr.stop())
          stream = s
          videoRef.current!.srcObject = s
          void videoRef.current!.play()
        })
        .catch((e) => console.error('webcam failed', e))
      activeGrabber = () => {
        const v = videoRef.current!
        if (!v.videoWidth) return Promise.reject(new Error('webcam has no frame yet'))
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        c.getContext('2d')!.drawImage(v, 0, 0) // saved un-mirrored; mirror is display only (CAM-2)
        return canvasToJpeg(c)
      }
    }

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
      activeGrabber = null
    }
  }, [source])

  const style = { transform: mirror ? 'scaleX(-1)' : undefined }
  return source === 'mock' ? (
    <canvas ref={canvasRef} width={MOCK_W} height={MOCK_H} className="liveview" style={style} />
  ) : (
    <video ref={videoRef} className="liveview" style={style} muted playsInline />
  )
}
