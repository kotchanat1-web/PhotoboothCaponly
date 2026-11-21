// Minimal Omise (Opn Payments) client — only what PromptPay needs.
// Verified against docs.omise.co (2026-11-20): promptpay, charges-api, sources-api, api-webhooks, api-authentication.

export interface OmiseCharge {
  object: 'charge'
  id: string
  /** subunits (satang) */
  amount: number
  currency: string
  /** failed | expired | pending | reversed | successful */
  status: string
  paid: boolean
  paid_at?: string | null
  expires_at?: string | null
  failure_code?: string | null
  failure_message?: string | null
  metadata?: Record<string, unknown> | null
  source?: { type?: string; scannable_code?: { image?: { download_uri?: string } | null } | null } | null
}

export interface OmiseError {
  object: 'error'
  code: string
  message: string
}

export class OmiseApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(`Omise ${status} ${code}: ${message}`)
  }
}

const REQUEST_MS = 10_000

export class Omise {
  constructor(
    private base: string,
    private secretKey: string,
    private fetchFn: typeof fetch = (...a) => fetch(...a)
  ) {}

  private auth(): string {
    // HTTP Basic: key as username, empty password (api-authentication)
    return `Basic ${btoa(`${this.secretKey}:`)}`
  }

  private async call<T>(method: string, path: string, form?: URLSearchParams): Promise<T> {
    const res = await this.fetchFn(`${this.base.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        Authorization: this.auth(),
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
      },
      body: form?.toString(),
      signal: AbortSignal.timeout(REQUEST_MS)
    })
    const body = (await res.json().catch(() => null)) as (T & { object?: string }) | OmiseError | null
    if (!res.ok || !body || body.object === 'error') {
      const err = body as OmiseError | null
      throw new OmiseApiError(res.status, err?.code ?? 'unknown', err?.message ?? 'no body')
    }
    return body as T
  }

  /**
   * One-step PromptPay charge (server side, secret key): source[type]=promptpay.
   * ref_id = our charge id → Omise refuses a second charge with the same ref_id (idempotency on retry).
   */
  createPromptPayCharge(p: {
    amountSatang: number
    currency: string
    refId: string
    expiresAt: Date
    description: string
    metadata: Record<string, string>
  }): Promise<OmiseCharge> {
    const f = new URLSearchParams()
    f.set('amount', String(p.amountSatang))
    f.set('currency', p.currency)
    f.set('source[type]', 'promptpay')
    // ISO 8601 without milliseconds, must be within 24 h (promptpay docs)
    f.set('expires_at', p.expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z'))
    f.set('ref_id', p.refId)
    f.set('description', p.description)
    for (const [k, v] of Object.entries(p.metadata)) f.set(`metadata[${k}]`, v)
    return this.call<OmiseCharge>('POST', '/charges', f)
  }

  getCharge(id: string): Promise<OmiseCharge> {
    return this.call<OmiseCharge>('GET', `/charges/${encodeURIComponent(id)}`)
  }

  /** Connectivity + key check for the booth's pre-payment health check. */
  async ping(): Promise<void> {
    await this.call<unknown>('GET', '/account')
  }

  /** Download the QR image (SVG by default) and return it as a data: URL for the booth screen. */
  async qrDataUrl(downloadUri: string): Promise<string> {
    const res = await this.fetchFn(downloadUri, { headers: { Authorization: this.auth() }, signal: AbortSignal.timeout(REQUEST_MS) })
    if (!res.ok) throw new OmiseApiError(res.status, 'qr_download_failed', downloadUri)
    const type = (res.headers.get('content-type') ?? 'image/svg+xml').split(';')[0]!.trim()
    const bytes = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return `data:${type};base64,${btoa(bin)}`
  }
}
