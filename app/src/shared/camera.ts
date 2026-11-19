// Pure helpers for webcam-style cameras (W1 USB webcam, W2 Canon EOS Webcam Utility — DEC-015).
// Shared by main and renderer so they can be unit-tested in Node.

export type Rotation = 0 | 90 | 180 | 270

export interface VideoDevice {
  deviceId: string
  label: string
  kind: string
}

/**
 * Choose the video input to use.
 * - `wanted` empty → first video input.
 * - otherwise → first device whose label contains `wanted` (case-insensitive);
 *   null if none matches, so the booth reports "camera not ready" instead of silently using the wrong camera.
 */
export function pickVideoDevice(devices: VideoDevice[], wanted: string): VideoDevice | null {
  const inputs = devices.filter((d) => d.kind === 'videoinput')
  const w = wanted.trim().toLowerCase()
  if (!w) return inputs[0] ?? null
  return inputs.find((d) => d.label.toLowerCase().includes(w)) ?? null
}

export function isRotation(v: unknown): v is Rotation {
  return v === 0 || v === 90 || v === 180 || v === 270
}

/** Size of a frame after rotating it by `rot` degrees. */
export function rotatedSize(w: number, h: number, rot: Rotation): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h }
}

/**
 * How much a source frame must be enlarged to fill a photo slot with cover-crop.
 * <= 1 → enough pixels; > 1 → upscaled (softer print). Same maths as coverRect in compose.ts.
 */
export function upscaleFactor(srcW: number, srcH: number, slotW: number, slotH: number): number {
  return Math.max(slotW / srcW, slotH / srcH)
}
