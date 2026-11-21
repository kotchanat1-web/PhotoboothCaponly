import { randomUUID } from 'node:crypto'

// PAY-8: payment provider abstraction.
//  - mock   → development (DEC-006)
//  - server → our payment server (server/, DEC-018): it alone decides "paid", after checking the charge with Omise (DEC-019)

export interface Charge {
  chargeId: string
  /** PromptPay QR payload to render as a QR code (mock only) */
  qrPayload: string
  /** ready-made QR image (data: URL) from the gateway; null for mock */
  qrImage: string | null
  expiresAt: number
}

export interface PaymentHealth {
  ready: boolean
  error?: string
}

export interface CreateChargeRequest {
  /** expected amount in baht — the server cross-checks it against its own price table */
  amount: number
  currency: string
  qty: number
  /** session id */
  reference: string
  expiresInSec: number
}

/** A verified payment the booth never used (crash, paid after cancel) — staff must compensate (PAY-7, BR-02). */
export interface UnclaimedPayment {
  chargeId: string
  sessionId: string
  amount: number
  paidAt: string | null
}

export interface PaymentProvider {
  readonly id: string
  /** BR-01 extension (DEC-019): can a customer pay right now? Checked before any payment screen. */
  health(): Promise<PaymentHealth>
  createCharge(req: CreateChargeRequest): Promise<Charge>
  cancelCharge(chargeId: string): Promise<void>
  /** Register the single listener for confirmed payments. */
  onPaid(listener: (chargeId: string) => void): void
  /** The booth started the service for this payment (only for payments it accepted). */
  claim?(chargeId: string): Promise<void>
  /** Verified payments never claimed by this booth. */
  unclaimed?(): Promise<UnclaimedPayment[]>
}

/** Mock provider for development. Pays automatically after `autoPaySec` (0 = never) or via `simulatePaid`. */
export class MockPaymentProvider implements PaymentProvider {
  readonly id = 'mock'
  private listener: ((chargeId: string) => void) | null = null
  private open = new Map<string, ReturnType<typeof setTimeout> | null>()

  constructor(private opts: { autoPaySec: number; now?: () => number }) {}

  async health(): Promise<PaymentHealth> {
    return { ready: true }
  }

  async createCharge(req: CreateChargeRequest): Promise<Charge> {
    const chargeId = `mock_${randomUUID().slice(0, 8)}`
    const now = this.opts.now?.() ?? Date.now()
    const timer = this.opts.autoPaySec > 0 ? setTimeout(() => this.simulatePaid(chargeId), this.opts.autoPaySec * 1000) : null
    this.open.set(chargeId, timer)
    return {
      chargeId,
      qrPayload: `MOCK-PROMPTPAY|${req.reference}|${req.amount.toFixed(2)} ${req.currency}`,
      qrImage: null,
      expiresAt: now + req.expiresInSec * 1000
    }
  }

  async cancelCharge(chargeId: string): Promise<void> {
    const t = this.open.get(chargeId)
    if (t) clearTimeout(t)
    this.open.delete(chargeId)
  }

  onPaid(listener: (chargeId: string) => void): void {
    this.listener = listener
  }

  /** Dev/test only. Fires even for cancelled charges so the "paid after cancel" path can be tested. */
  simulatePaid(chargeId: string): void {
    const t = this.open.get(chargeId)
    if (t) clearTimeout(t)
    this.open.delete(chargeId)
    this.listener?.(chargeId)
  }
}
