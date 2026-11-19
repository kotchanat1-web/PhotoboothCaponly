import { randomUUID } from 'node:crypto'

// PAY-8: payment provider abstraction. Omise comes in M2 (DEC-006).
// BR-07 (draft): a real provider must only report "paid" from a signature-verified webhook.

export interface Charge {
  chargeId: string
  /** PromptPay QR payload to render as a QR code */
  qrPayload: string
  expiresAt: number
}

export interface PaymentProvider {
  readonly id: string
  createCharge(req: { amount: number; currency: string; reference: string; expiresInSec: number }): Promise<Charge>
  cancelCharge(chargeId: string): Promise<void>
  /** Register the single listener for confirmed payments. */
  onPaid(listener: (chargeId: string) => void): void
}

/** Mock provider for development. Pays automatically after `autoPaySec` (0 = never) or via `simulatePaid`. */
export class MockPaymentProvider implements PaymentProvider {
  readonly id = 'mock'
  private listener: ((chargeId: string) => void) | null = null
  private open = new Map<string, ReturnType<typeof setTimeout> | null>()

  constructor(private opts: { autoPaySec: number; now?: () => number }) {}

  async createCharge(req: { amount: number; currency: string; reference: string; expiresInSec: number }): Promise<Charge> {
    const chargeId = `mock_${randomUUID().slice(0, 8)}`
    const now = this.opts.now?.() ?? Date.now()
    const timer = this.opts.autoPaySec > 0 ? setTimeout(() => this.simulatePaid(chargeId), this.opts.autoPaySec * 1000) : null
    this.open.set(chargeId, timer)
    return {
      chargeId,
      qrPayload: `MOCK-PROMPTPAY|${req.reference}|${req.amount.toFixed(2)} ${req.currency}`,
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
