import { env } from 'cloudflare:test'
import { vi } from 'vitest'
import type { AppEnv } from '../src/env'
import worker from '../src/index'
import type { OmiseCharge } from '../src/omise'
import { sha256Hex } from '../src/verify'

export const E = env as unknown as AppEnv
export const BASE = 'https://pay.test'

/** In-memory stand-in for api.omise.co (only the endpoints the server uses). */
export class FakeOmise {
  charges = new Map<string, OmiseCharge>()
  forms: URLSearchParams[] = []
  refIds = new Set<string>()
  down = false
  createError: string | null = null
  calls: string[] = []
  private n = 0

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    this.calls.push(`${req.method} ${url.pathname}`)
    if (this.down) return Response.json({ object: 'error', code: 'service_unavailable', message: 'down' }, { status: 503 })
    if (!req.headers.get('Authorization')?.startsWith('Basic ')) return Response.json({ object: 'error', code: 'authentication_failure', message: 'no key' }, { status: 401 })
    if (req.method === 'GET' && url.pathname === '/account') return Response.json({ object: 'account', id: 'acct_test' })
    if (req.method === 'POST' && url.pathname === '/charges') {
      const f = new URLSearchParams([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]))
      this.forms.push(f)
      if (this.createError) return Response.json({ object: 'error', code: 'bad_request', message: this.createError }, { status: 400 })
      const ref = f.get('ref_id')!
      if (this.refIds.has(ref)) return Response.json({ object: 'error', code: 'bad_request', message: 'ref_id already used' }, { status: 400 })
      this.refIds.add(ref)
      const id = `chrg_test_${++this.n}`
      const metadata: Record<string, string> = {}
      for (const [k, v] of f) {
        const m = /^metadata\[(.+)\]$/.exec(k)
        if (m) metadata[m[1]!] = v
      }
      const c: OmiseCharge = {
        object: 'charge',
        id,
        amount: Number(f.get('amount')),
        currency: f.get('currency')!.toLowerCase(),
        status: 'pending',
        paid: false,
        expires_at: f.get('expires_at'),
        metadata,
        source: { type: 'promptpay', scannable_code: { image: { download_uri: `https://omise.test/qr/${id}` } } }
      }
      this.charges.set(id, c)
      return Response.json(c)
    }
    const qr = /^\/qr\/(.+)$/.exec(url.pathname)
    if (req.method === 'GET' && qr) return new Response(`<svg xmlns="http://www.w3.org/2000/svg"><text>${qr[1]}</text></svg>`, { headers: { 'Content-Type': 'image/svg+xml' } })
    const ch = /^\/charges\/(.+)$/.exec(url.pathname)
    if (req.method === 'GET' && ch) {
      const c = this.charges.get(decodeURIComponent(ch[1]!))
      return c ? Response.json(c) : Response.json({ object: 'error', code: 'not_found', message: 'no charge' }, { status: 404 })
    }
    return Response.json({ object: 'error', code: 'not_found', message: url.pathname }, { status: 404 })
  }

  /** Customer pays in their bank app (what Omise would record). */
  pay(id: string, over: Partial<OmiseCharge> = {}): OmiseCharge {
    const c = this.charges.get(id)!
    Object.assign(c, { status: 'successful', paid: true, paid_at: new Date().toISOString() }, over)
    return c
  }
}

export function installFakeOmise(): FakeOmise {
  const fake = new FakeOmise()
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    if (new URL(req.url).origin === 'https://omise.test') return fake.handle(req)
    return real(req)
  })
  return fake
}

export async function addBooth(id: string, key: string, active = 1): Promise<void> {
  await E.DB.prepare('INSERT INTO booths (id, name, key_hash, active, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, `Booth ${id}`, await sha256Hex(key), active, new Date().toISOString())
    .run()
}

export const KEY_A = 'booth-a-secret-key-0001'
export const KEY_B = 'booth-b-secret-key-0002'

export function call(method: string, path: string, opts: { booth?: [string, string] | null; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  const b = opts.booth === undefined ? ['A', KEY_A] : opts.booth
  if (b) headers['Authorization'] = `Bearer ${b[0]}.${b[1]}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const req = new Request(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })
  return worker.fetch(req, E)
}

/** Sign like Omise: hex(HMAC-SHA256(base64decode(secret), `${ts}.${body}`)). */
export async function signedWebhook(body: unknown, opts: { secretB64?: string; ts?: number; tamper?: boolean } = {}) {
  const raw = JSON.stringify(body)
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000))
  const keyBytes = Uint8Array.from(atob(opts.secretB64 ?? E.OMISE_WEBHOOK_SECRET!), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${raw}`)))
  const sig = [...mac].map((x) => x.toString(16).padStart(2, '0')).join('')
  const sent = opts.tamper ? raw.replace('charge', 'charge ') : raw
  return worker.fetch(
    new Request(`${BASE}/webhooks/omise`, { method: 'POST', headers: { 'Omise-Signature': sig, 'Omise-Signature-Timestamp': ts, 'Content-Type': 'application/json' }, body: sent }),
    E
  )
}

export const chargeEvent = (omiseId: string, key = 'charge.complete') => ({ object: 'event', key, data: { object: 'charge', id: omiseId } })

export async function createCharge(qty = 1, amount = 130, sessionId = '20261121100000') {
  const res = await call('POST', '/v1/charges', { body: { sessionId, qty, amount } })
  return { res, body: (await res.json()) as Record<string, unknown> & { chargeId: string; status: string; qrImage: string } }
}

export async function omiseIdOf(chargeId: string): Promise<string> {
  const r = await E.DB.prepare('SELECT omise_charge_id FROM charges WHERE id = ?').bind(chargeId).first<{ omise_charge_id: string }>()
  return r!.omise_charge_id
}

export async function auditEvents(chargeId: string): Promise<string[]> {
  const { results } = await E.DB.prepare('SELECT event FROM audit WHERE charge_id = ? ORDER BY id').bind(chargeId).all<{ event: string }>()
  return results.map((r) => r.event)
}
