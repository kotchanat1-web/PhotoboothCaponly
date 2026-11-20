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
/** why the last stream closed by itself (ISS-007) — reported if a capture then finds no frame */
let lostReason: string | null = null
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
    // unplugged / taken by another app → close; the next probe, live view or capture reopens it (ISS-007)
    s.getVideoTracks().forEach((t) =>
      t.addEventListener('ended', () => {
        if (stream !== s) return
        lostReason = 'webcam stream ended (camera unplugged or used by another program)'
        console.warn(lostReason)
        closeWebcam()
      })
    )
    lostReason = null
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
  drawSourceRotated(canvas, video, video.videoWidth, video.videoHeight, scale)
}

function drawSourceRotated(canvas: HTMLCanvasElement, src: CanvasImageSource, vw: number, vh: number, scale: number): void {
  const rot = rotation()
  const out = rotatedSize(vw, vh, rot)
  const w = Math.round(out.w * scale)
  const h = Math.round(out.h * scale)
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(src, (-vw * scale) / 2, (-vh * scale) / 2, vw * scale, vh * scale)
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

const FRAME_WAIT_MS = 3000
const REOPEN_MS = 2000

/**
 * ISS-007: make sure the webcam is open and has a decoded frame before grabbing.
 * Reopens the stream if it was closed (ended track / Idle) and waits up to FRAME_WAIT_MS.
 */
async function ensureWebcamFrame(): Promise<void> {
  const hasFrame = () => video.videoWidth > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  if (hasFrame()) return
  await openWebcam()
  if (video.paused) await video.play().catch(() => {})
  const until = Date.now() + FRAME_WAIT_MS
  while (!hasFrame() && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
  if (!hasFrame()) throw new Error(`webcam has no frame${lostReason ? `: ${lostReason}` : ''}`)
}

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
    let timer: ReturnType<typeof setTimeout> | undefined
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
    } else if (cfg.source === 'digicam') {
      // DEC-016: frames from digiCamControl, proxied by main as booth://liveview/frame.jpg.
      // Photos are taken by the DSLR itself (main process), so there is no grabber here.
      let n = 0
      const next = () => {
        if (stopped) return
        const img = new Image()
        img.onload = () => {
          if (stopped) return
          const long = Math.max(img.naturalWidth, img.naturalHeight)
          drawSourceRotated(canvas, img, img.naturalWidth, img.naturalHeight, Math.min(1, DISPLAY_MAX / long))
          timer = setTimeout(next, 30)
        }
        img.onerror = () => {
          if (!stopped) timer = setTimeout(next, 500) // live view not started yet / no camera
        }
        img.src = `booth://liveview/frame.jpg?n=${n++}`
      }
      next()
    } else {
      // the loop also reopens a lost stream (ISS-007), at most once per REOPEN_MS
      let lastOpen = 0
      const tryOpen = () => {
        lastOpen = Date.now()
        void openWebcam().catch((e) => console.error('webcam failed', e))
      }
      tryOpen()
      const loop = () => {
        if (stopped) return
        if (!stream && !opening && Date.now() - lastOpen > REOPEN_MS) tryOpen()
        if (video.videoWidth) {
          const long = Math.max(video.videoWidth, video.videoHeight)
          drawRotated(canvas, Math.min(1, DISPLAY_MAX / long))
        }
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      activeGrabber = async () => {
        await ensureWebcamFrame()
        const full = document.createElement('canvas')
        drawRotated(full, 1) // full resolution, rotated, NOT mirrored (mirror is display only — CAM-2)
        return canvasToJpeg(full)
      }
    }

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      activeGrabber = null
    }
  }, [cfg.source])

  return <canvas ref={canvasRef} className="liveview" style={{ transform: cfg.mirror ? 'scaleX(-1)' : undefined }} />
}
