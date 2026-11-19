import { useEffect, useRef } from 'react'
import { pickVideoDevice, rotatedSize, type Rotation } from '../../shared/camera'
import type { Snapshot } from '../../shared/types'

type LiveViewConfig = Snapshot['liveView']

// ---------------------------------------------------------------------------------------------
// Webcam source (W1 USB webcam / W2 Canon EOS Webcam Utility — DEC-015).
// One shared stream: opened at CheckDevices (probe), reused by the live view and capture,
// closed when the booth goes back to Idle so the camera is not streaming all day.
// ---------------------------------------------------------------------------------------------

let config: LiveViewConfig | null = null
let stream: MediaStream | null = null
let opening: Promise<MediaStream> | null = null
let deviceLabel = ''
let allLabels: string[] = []
const video = document.createElement('video')
video.muted = true
video.playsInline = true

/** App calls this on every snapshot so the camera module knows the current settings. */
export function setCameraConfig(c: LiveViewConfig): void {
  config = c
}

export function closeWebcam(): void {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  opening = null
  video.srcObject = null
}

async function listDevices() {
  return (await navigator.mediaDevices.enumerateDevices()).map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }))
}

async function openWebcam(): Promise<MediaStream> {
  if (stream && stream.getVideoTracks().some((t) => t.readyState === 'live')) return stream
  if (opening) return opening
  const cfg = config
  if (!cfg) throw new Error('camera config not received yet')
  opening = (async () => {
    let devices = await listDevices()
    // labels are empty until the first permission grant — open any camera once to unlock them
    if (devices.some((d) => d.kind === 'videoinput' && !d.label)) {
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      tmp.getTracks().forEach((t) => t.stop())
      devices = await listDevices()
    }
    allLabels = devices.filter((d) => d.kind === 'videoinput').map((d) => d.label || '(no name)')
    const dev = pickVideoDevice(devices, cfg.webcam.deviceLabel)
    if (!dev) {
      throw new Error(
        cfg.webcam.deviceLabel
          ? `no camera named "${cfg.webcam.deviceLabel}" (found: ${allLabels.join(', ') || 'none'})`
          : 'no webcam found'
      )
    }
    const s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: dev.deviceId },
        width: { ideal: cfg.webcam.idealWidth },
        height: { ideal: cfg.webcam.idealHeight }
      }
    })
    s.getVideoTracks().forEach((t) => t.addEventListener('ended', closeWebcam)) // unplugged → next probe reopens
    deviceLabel = dev.label
    stream = s
    video.srcObject = s
    await video.play()
    // wait for the first frame so width/height are real
    if (!video.videoWidth) await new Promise<void>((r) => video.addEventListener('loadedmetadata', () => r(), { once: true }))
    return s
  })()
  try {
    return await opening
  } finally {
    opening = null
  }
}

function rotation(): Rotation {
  return config?.rotation ?? 0
}

/** Draw the current webcam frame, rotated for the camera mounting, into `canvas` scaled by `scale`. */
function drawRotated(canvas: HTMLCanvasElement, scale: number): void {
  const rot = rotation()
  const vw = video.videoWidth
  const vh = video.videoHeight
  const out = rotatedSize(vw, vh, rot)
  const w = Math.round(out.w * scale)
  const h = Math.round(out.h * scale)
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(video, (-vw * scale) / 2, (-vh * scale) / 2, vw * scale, vh * scale)
  ctx.restore()
}

/** RPC camera:probe — open the selected webcam and report its real resolution (after rotation). */
export async function probeWebcam(): Promise<{ ready: boolean; model?: string; error?: string; width?: number; height?: number; devices?: string[] }> {
  try {
    await openWebcam()
    const { w, h } = rotatedSize(video.videoWidth, video.videoHeight, rotation())
    return { ready: true, model: deviceLabel || 'Webcam', width: w, height: h, devices: allLabels }
  } catch (e) {
    return { ready: false, error: e instanceof Error ? e.message : String(e), devices: allLabels }
  }
}

// ---------------------------------------------------------------------------------------------
// Frame grabbing (camera:grab) — the live view on screen registers how to grab a full-res frame.
// ---------------------------------------------------------------------------------------------

let activeGrabber: (() => Promise<ArrayBuffer>) | null = null

export async function grabFrame(): Promise<ArrayBuffer> {
  if (!activeGrabber) throw new Error('live view not active')
  return activeGrabber()
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92)
  )
}

const MOCK_W = 800
const MOCK_H = 1200
/** live view is drawn at most this many pixels on the long side (capture always uses full resolution) */
const DISPLAY_MAX = 1280

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

export function LiveView({ cfg }: { cfg: LiveViewConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let raf = 0
    let stopped = false
    const canvas = canvasRef.current!

    if (cfg.source === 'mock') {
      canvas.width = MOCK_W
      canvas.height = MOCK_H
      const ctx = canvas.getContext('2d')!
      const loop = (t: number) => {
        drawMock(ctx, t)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      activeGrabber = () => canvasToJpeg(canvas)
    } else {
      void openWebcam()
        .then(() => {
          if (stopped) return
          const loop = () => {
            if (video.videoWidth) {
              const long = Math.max(video.videoWidth, video.videoHeight)
              drawRotated(canvas, Math.min(1, DISPLAY_MAX / long))
            }
            raf = requestAnimationFrame(loop)
          }
          raf = requestAnimationFrame(loop)
        })
        .catch((e) => console.error('webcam failed', e))
      activeGrabber = async () => {
        if (!video.videoWidth) throw new Error('webcam has no frame yet')
        const full = document.createElement('canvas')
        drawRotated(full, 1) // full resolution, rotated, NOT mirrored (mirror is display only — CAM-2)
        return canvasToJpeg(full)
      }
    }

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      activeGrabber = null
    }
  }, [cfg.source])

  return <canvas ref={canvasRef} className="liveview" style={{ transform: cfg.mirror ? 'scaleX(-1)' : undefined }} />
}
