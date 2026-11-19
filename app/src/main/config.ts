import { existsSync, readFileSync } from 'node:fs'
import type { BoothMode, TemplateInfo } from '../shared/types'

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
    showQr: number
    error: number
    deviceError: number
  }
  capture: { countdownSec: number; retries: number; mirrorLiveView: boolean }
  camera: {
    driver: 'mock' | 'webcam'
    powerCycle: { enabled: boolean; maxAttempts: number; offMs: number; bootMs: number }
  }
  printer: { driver: 'mock' }
  payment: { provider: 'mock'; qrExpirySec: number; mock: { autoPaySec: number } }
  relay: {
    driver: 'mock' | 'none'
    channels: { cabinetLight: number; sessionActive: number; paid: number; cameraPower: number }
  }
  paths: { sessionsDir: string; logsDir: string }
  logRetentionDays: number
  templates: TemplateInfo[]
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
  if (!(c.capture.countdownSec > 0)) errors.push('capture.countdownSec must be > 0')
  if (!(c.payment.qrExpirySec > 0)) errors.push('payment.qrExpirySec must be > 0')

  if (c.templates.length === 0) errors.push('templates must not be empty')
  const seen = new Set<string>()
  for (const t of c.templates) {
    // TPL-6 / BR-06 (draft): template ids must be unique
    if (seen.has(t.id)) errors.push(`duplicate template id "${t.id}"`)
    seen.add(t.id)
    if (!Number.isInteger(t.shots) || t.shots < 1) errors.push(`template "${t.id}" shots must be an integer >= 1`)
  }
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
