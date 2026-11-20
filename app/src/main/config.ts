import { existsSync, readFileSync } from 'node:fs'
import type { BoothMode } from '../shared/types'

export interface BoothConfig {
  mode: BoothMode
  boothName: string
  window: { fullscreen: boolean; kiosk: boolean; width: number; height: number }
  prices: Record<string, number>
  currency: string
  timeoutsSec: {
    selectPayment: number
    selectQty: number
    creatingCharge: number
    confirmCancel: number
    selectTemplate: number
    instruction: number
    shooting: number
    review: number
    compose: number
    print: number
    showQr: number
    error: number
    deviceError: number
  }
  /** retries = automatic re-shoot after a failed capture; maxRetakes = customer "ถ่ายใหม่" per shot (CAM-5) */
  capture: { countdownSec: number; retries: number; maxRetakes: number; mirrorLiveView: boolean }
  camera: {
    driver: 'mock' | 'webcam' | 'digicam'
    /** mounting rotation in degrees (0/90/180/270), applied to webcam frames */
    rotation: number
    /** W1/W2 (DEC-015): deviceLabel = part of the camera name, e.g. "EOS Webcam Utility"; empty = first camera */
    webcam: { deviceLabel: string; idealWidth: number; idealHeight: number }
    powerCycle: { enabled: boolean; maxAttempts: number; offMs: number; bootMs: number }
    /** DEC-016: DSLR via digiCamControl web server; exposure values "" = leave as set on the camera (CAM-1) */
    digicam: {
      baseUrl: string
      captureTimeoutMs: number
      exposure: { shutterspeed: string; aperture: string; iso: string; whitebalance: string }
    }
  }
  printer: { driver: 'mock' }
  payment: { provider: 'mock'; qrExpirySec: number; mock: { autoPaySec: number } }
  relay: {
    driver: 'mock' | 'none'
    channels: { cabinetLight: number; sessionActive: number; paid: number; cameraPower: number }
  }
  /** MODE-3 details pending User — prints per session in event mode (M1-2 Q2) */
  event: { printCopies: number }
  paths: { sessionsDir: string; logsDir: string; templatesDir: string }
  logRetentionDays: number
}

type Json = Record<string, unknown>

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep-merge plain objects; arrays and scalars from `override` replace `base`. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) return (override === undefined ? base : override) as T
  const out: Json = { ...base }
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : v
  }
  return out as T
}

/** Returns a list of problems; empty list = valid. */
export function validateConfig(c: BoothConfig): string[] {
  const errors: string[] = []
  if (c.mode !== 'kiosk' && c.mode !== 'event') errors.push(`mode must be "kiosk" or "event" (got "${String(c.mode)}")`)

  const qtys = Object.keys(c.prices)
  if (qtys.length === 0) errors.push('prices must have at least one entry')
  for (const q of qtys) {
    const n = Number(q)
    const price = c.prices[q]
    if (!Number.isInteger(n) || n < 1) errors.push(`prices key "${q}" must be a positive integer quantity`)
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) errors.push(`prices["${q}"] must be a number >= 0`)
  }

  for (const [k, v] of Object.entries(c.timeoutsSec)) {
    if (typeof v !== 'number' || !(v > 0)) errors.push(`timeoutsSec.${k} must be > 0`)
  }
  if (!['mock', 'webcam', 'digicam'].includes(c.camera.driver)) errors.push('camera.driver must be "mock", "webcam" or "digicam"')
  if (!/^https?:\/\//.test(c.camera.digicam.baseUrl)) errors.push('camera.digicam.baseUrl must start with http:// or https://')
  if (!(c.camera.digicam.captureTimeoutMs > 0)) errors.push('camera.digicam.captureTimeoutMs must be > 0')
  for (const [k, v] of Object.entries(c.camera.digicam.exposure)) {
    if (typeof v !== 'string') errors.push(`camera.digicam.exposure.${k} must be a string ("" = keep camera setting)`)
  }
  if (![0, 90, 180, 270].includes(c.camera.rotation)) errors.push('camera.rotation must be 0, 90, 180 or 270')
  if (!(c.camera.webcam.idealWidth > 0 && c.camera.webcam.idealHeight > 0)) errors.push('camera.webcam.idealWidth/idealHeight must be > 0')
  if (!(c.capture.countdownSec > 0)) errors.push('capture.countdownSec must be > 0')
  if (!Number.isInteger(c.capture.maxRetakes) || c.capture.maxRetakes < 0) errors.push('capture.maxRetakes must be an integer >= 0')
  if (!(c.payment.qrExpirySec > 0)) errors.push('payment.qrExpirySec must be > 0')

  if (!Number.isInteger(c.event.printCopies) || c.event.printCopies < 1) errors.push('event.printCopies must be an integer >= 1')
  // templates are loaded from paths.templatesDir (templates.ts); ids = folder names, unique by construction (DEC-012)
  return errors
}

/** Load default.json, then merge optional local.json (per-machine, not in git). */
export function loadConfig(defaultPath: string, localPath: string): BoothConfig {
  const base = JSON.parse(readFileSync(defaultPath, 'utf8')) as BoothConfig
  const local = existsSync(localPath) ? (JSON.parse(readFileSync(localPath, 'utf8')) as unknown) : undefined
  const cfg = deepMerge(base, local)
  const errors = validateConfig(cfg)
  if (errors.length > 0) throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`)
  return cfg
}
