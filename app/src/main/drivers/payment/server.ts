import type { Charge, CreateChargeRequest, PaymentHealth, PaymentProvider, UnclaimedPayment } from './index'

export interface ServerPaymentOptions {
  /** e.g. https://photobooth-payments.<account>.workers.dev */
  baseUrl: string
  boothId: string
  /** secret — only in local.json (never in git) */
  boothKey: string
  /** how often to ask the server while a QR is open (the WebSocket push is the fast path) */
  pollSec: number
  /** keep watching this long after the QR expired / was cancelled, to catch late money */
  lateWatchSec: number
  fetch?: typeof fetch
  /** null = no WebSocket (poll only) */
  webSocket?: (url: string, headers: Record<string, string>) => WebSocketLike | null
  log?: (level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) => void
  now?: () => number
}

export interface WebSocketLike {
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  close(): void
}

interface ChargeView {
  chargeId: string
  status: string
  paid: boolean
  expiresAt: number | null
  amount: number
  sessionId: string
  paidAt: string | null
}

const REQUEST_MS = 10_000
/** the customer is waiting on the "checking" screen — fail fast if the server is down */
const HEALTH_MS = 5_000
const FINAL_UNPAID = new Set(['failed', 'expired', 'mismatch', 'error'])

/**
 * Payment through our server (DEC-018). The booth never talks to Omise and never holds the Omise key.
 * "Paid" = the server says status successful for this charge (server verified it with Omise — DEC-019).
 * A WebSocket push only triggers an immediate status request; the push itself never pays.
 */
export class ServerPaymentProvider implements PaymentProvider {
  readonly id = 'server'
  private listener: ((chargeId: string) => void) | null = null
  private watched = new Map<string, { until: number; timer: ReturnType<typeof setTimeout> | null; busy: boolean }>()
  private ws: WebSocketLike | null = null
  private wsRetry: ReturnType<typeof setTimeout> | null = null
  private readonly fetch: typeof fetch
  private readonly now: () => number

  constructor(private opts: ServerPaymentOptions) {
    this.fetch = opts.fetch ?? ((...a) => fetch(...a))
    this.now = opts.now ?? Date.now
  }

  private base(): string {
    return this.opts.baseUrl.replace(/\/+$/, '')
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.opts.boothId}.${this.opts.boothKey}` }
  }

  private async api<T>(method: string, path: string, body?: unknown, timeoutMs = REQUEST_MS): Promise<{ status: number; data: T }> {
    const res = await this.fetch(`${this.base()}${path}`, {
      method,
      headers: { ...this.headers(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const data = (await res.json().catch(() => ({}))) as T
    return { status: res.status, data }
  }

  async health(): Promise<PaymentHealth> {
    try {
      const r = await this.api<{ ok?: boolean; problems?: string[]; error?: string }>('GET', '/v1/health', undefined, HEALTH_MS)
      if (r.status === 200 && r.data.ok) return { ready: true }
      return { ready: false, error: `payment server: ${r.data.problems?.join('; ') || r.data.error || `HTTP ${r.status}`}` }
    } catch (e) {
      return { ready: false, error: `payment server not reachable: ${errText(e)}` }
    }
  }

  async createCharge(req: CreateChargeRequest): Promise<Charge> {
    const r = await this.api<ChargeView & { qrImage?: string; error?: string; message?: string; serverAmount?: number }>('POST', '/v1/charges', {
      sessionId: req.reference,
      qty: req.qty,
      amount: req.amount
    })
    if (r.status === 409 && r.data.error === 'price_mismatch') {
      throw new Error(`ราคาในตู้ (${req.amount}) ไม่ตรงกับ server (${r.data.serverAmount}) — ตรวจตารางราคา`)
    }
    if (r.status !== 201 || !r.data.qrImage || !r.data.expiresAt) throw new Error(`payment server: ${r.data.message ?? r.data.error ?? `HTTP ${r.status}`}`)
    this.watch(r.data.chargeId, r.data.expiresAt + this.opts.lateWatchSec * 1000)
    return { chargeId: r.data.chargeId, qrPayload: '', qrImage: r.data.qrImage, expiresAt: r.data.expiresAt }
  }

  /** PromptPay cannot be cancelled at the gateway: tell the server, keep watching for late money (→ machine records orphan). */
  async cancelCharge(chargeId: string): Promise<void> {
    await this.api('POST', `/v1/charges/${encodeURIComponent(chargeId)}/cancel`)
  }

  onPaid(listener: (chargeId: string) => void): void {
    this.listener = listener
  }

  async claim(chargeId: string): Promise<void> {
    // retried: a failed claim would wrongly list the payment for compensation
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await this.api('POST', `/v1/charges/${encodeURIComponent(chargeId)}/claim`)
        if (r.status === 200) return
        this.opts.log?.('warn', 'payment.claim_failed', { chargeId, status: r.status, attempt })
      } catch (e) {
        this.opts.log?.('warn', 'payment.claim_failed', { chargeId, error: errText(e), attempt })
      }
    }
  }

  async unclaimed(): Promise<UnclaimedPayment[]> {
    const r = await this.api<{ charges?: ChargeView[] }>('GET', '/v1/charges/unclaimed')
    if (r.status !== 200) throw new Error(`payment server HTTP ${r.status}`)
    return (r.data.charges ?? []).map((c) => ({ chargeId: c.chargeId, sessionId: c.sessionId, amount: c.amount, paidAt: c.paidAt }))
  }

  /** Stop all timers/sockets (app exit, tests). */
  close(): void {
    for (const w of this.watched.values()) if (w.timer) clearTimeout(w.timer)
    this.watched.clear()
    this.closeWs()
  }

  // ------------------------------------------------------------------------------------------ watching

  private watch(chargeId: string, until: number): void {
    this.watched.set(chargeId, { until, timer: null, busy: false })
    this.schedule(chargeId)
    this.ensureWs()
  }

  private schedule(chargeId: string): void {
    const w = this.watched.get(chargeId)
    if (!w) return
    if (w.timer) clearTimeout(w.timer)
    w.timer = setTimeout(() => void this.check(chargeId), this.opts.pollSec * 1000)
  }

  private stopWatching(chargeId: string): void {
    const w = this.watched.get(chargeId)
    if (w?.timer) clearTimeout(w.timer)
    this.watched.delete(chargeId)
    if (this.watched.size === 0) this.closeWs()
  }

  /** Ask the server for the verified status of one charge. */
  async check(chargeId: string): Promise<void> {
    const w = this.watched.get(chargeId)
    if (!w || w.busy) return
    w.busy = true
    try {
      const r = await this.api<ChargeView>('GET', `/v1/charges/${encodeURIComponent(chargeId)}`)
      if (r.status === 200 && r.data.chargeId === chargeId) {
        if (r.data.paid && r.data.status === 'successful') {
          this.stopWatching(chargeId)
          this.opts.log?.('info', 'payment.verified', { chargeId })
          this.listener?.(chargeId)
          return
        }
        if (FINAL_UNPAID.has(r.data.status)) {
          this.opts.log?.('warn', 'payment.final_unpaid', { chargeId, status: r.data.status })
          this.stopWatching(chargeId)
          return
        }
      } else {
        this.opts.log?.('warn', 'payment.status_failed', { chargeId, status: r.status })
      }
    } catch (e) {
      this.opts.log?.('warn', 'payment.status_failed', { chargeId, error: errText(e) })
    } finally {
      w.busy = false
    }
    if (this.now() > w.until) {
      this.opts.log?.('info', 'payment.watch_ended', { chargeId })
      this.stopWatching(chargeId)
      return
    }
    this.schedule(chargeId)
  }

  private ensureWs(): void {
    if (this.ws || this.wsRetry || !this.opts.webSocket) return
    let ws: WebSocketLike | null = null
    try {
      ws = this.opts.webSocket(`${this.base().replace(/^http/, 'ws')}/v1/ws`, this.headers())
    } catch (e) {
      this.opts.log?.('warn', 'payment.ws_failed', { error: errText(e) })
    }
    if (!ws) return
    this.ws = ws
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type?: string; chargeId?: string }
        if (msg.type === 'charge' && msg.chargeId && this.watched.has(msg.chargeId)) void this.check(msg.chargeId)
      } catch {
        // ignore non-JSON (e.g. "pong")
      }
    }
    const lost = () => {
      if (this.ws !== ws) return
      this.ws = null
      // reconnect only while a QR is open; the poll keeps working meanwhile
      if (this.watched.size > 0) this.wsRetry = setTimeout(() => ((this.wsRetry = null), this.ensureWs()), 5000)
    }
    ws.onclose = lost
    ws.onerror = lost
  }

  private closeWs(): void {
    if (this.wsRetry) clearTimeout(this.wsRetry)
    this.wsRetry = null
    const ws = this.ws
    this.ws = null
    try {
      ws?.close()
    } catch {
      // already closed
    }
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
