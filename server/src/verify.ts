// The money rules. Pure functions — unit tested with known answers.
import type { OmiseCharge } from './omise'

export interface ChargeRow {
  id: string
  booth_id: string
  session_id: string
  qty: number
  amount_satang: number
  currency: string
  omise_charge_id: string | null
  status: string
  failure: string | null
  created_at: string
  expires_at: string | null
  paid_at: string | null
  cancel_requested_at: string | null
  claimed_at: string | null
  last_checked_at: string | null
}

export type Judgement =
  | { status: 'successful'; paidAt: string }
  | { status: 'pending' }
  | { status: 'failed' | 'expired'; reason: string }
  | { status: 'mismatch'; reason: string }

/**
 * BR-07 (DEC-019): a charge counts as paid ONLY when the charge fetched from Omise
 *  - is the same charge (id + our metadata.charge_id), and
 *  - status = successful AND paid = true, and
 *  - amount and currency equal what this booth asked for.
 * Anything inconsistent → "mismatch" (never paid, kept for staff to review).
 */
export function judgeCharge(row: ChargeRow, oc: OmiseCharge): Judgement {
  if (!row.omise_charge_id || oc.id !== row.omise_charge_id) return { status: 'mismatch', reason: `charge id ${oc.id} != ${row.omise_charge_id}` }
  const metaId = oc.metadata?.['charge_id']
  if (metaId !== row.id) return { status: 'mismatch', reason: `metadata.charge_id ${String(metaId)} != ${row.id}` }
  switch (oc.status) {
    case 'successful':
      if (oc.paid !== true) return { status: 'mismatch', reason: 'status successful but paid=false' }
      if (oc.amount !== row.amount_satang) return { status: 'mismatch', reason: `amount ${oc.amount} != ${row.amount_satang}` }
      if (oc.currency.toUpperCase() !== row.currency.toUpperCase()) return { status: 'mismatch', reason: `currency ${oc.currency} != ${row.currency}` }
      return { status: 'successful', paidAt: oc.paid_at ?? new Date().toISOString() }
    case 'pending':
      return { status: 'pending' }
    case 'expired':
      return { status: 'expired', reason: 'expired at Omise' }
    case 'failed':
      return { status: 'failed', reason: oc.failure_code ?? 'failed' }
    case 'reversed':
      return { status: 'failed', reason: 'reversed' }
    default:
      return { status: 'mismatch', reason: `unknown Omise status ${oc.status}` }
  }
}

/** Final states never change again — a late webhook cannot turn "mismatch" into paid, nor "successful" into failed. */
export function isFinal(status: string): boolean {
  return status === 'successful' || status === 'failed' || status === 'expired' || status === 'mismatch' || status === 'error'
}

/** Booth price check: the booth's displayed amount (baht) must equal the server price (satang). */
export function satangFromBaht(baht: number): number {
  return Math.round(baht * 100)
}

/**
 * Omise webhook signature (api-webhooks):
 *   Omise-Signature = hex(HMAC-SHA256(base64decode(secret), `${timestamp}.${rawBody}`)), may hold several comma-separated
 *   Omise-Signature-Timestamp = unix seconds; we reject anything older/newer than `toleranceSec`.
 */
export async function verifyOmiseSignature(opts: {
  rawBody: string
  signature: string | null
  timestamp: string | null
  secretBase64: string
  nowSec: number
  toleranceSec?: number
}): Promise<boolean> {
  const { rawBody, signature, timestamp, secretBase64, nowSec } = opts
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false
  if (Math.abs(nowSec - Number(timestamp)) > (opts.toleranceSec ?? 300)) return false
  let keyBytes: Uint8Array
  try {
    keyBytes = Uint8Array.from(atob(secretBase64), (c) => c.charCodeAt(0))
  } catch {
    return false
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`)))
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
  return signature.split(',').some((s) => constantTimeEqual(s.trim().toLowerCase(), expected))
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('')
}
