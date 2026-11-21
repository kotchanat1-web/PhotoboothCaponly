import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerPaymentProvider, type WebSocketLike } from '../src/main/drivers/payment/server'
import { validateConfig } from '../src/main/config'
import { defaultConfig, setup, tick } from './helpers'

afterEach(() => {
  vi.useRealTimers()
})

type Handler = (method: string, path: string, body: unknown, headers: Headers) => { status: number; body: unknown }

function fakeServer(handler: Handler) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, body, auth: headers.get('Authorization') })
    const r = handler(init?.method ?? 'GET', url.pathname, body, headers)
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { calls, fetchImpl }
}

class FakeWs implements WebSocketLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  closed = false
  close() {
    this.closed = true
  }
}

const QR = 'data:image/svg+xml;base64,PHN2Zy8+'

function provider(handler: Handler, ws?: FakeWs) {
  const srv = fakeServer(handler)
  const p = new ServerPaymentProvider({
    baseUrl: 'https://pay.test/',
    boothId: 'booth1',
    boothKey: 'k'.repeat(32),
    pollSec: 3,
    lateWatchSec: 60,
    fetch: srv.fetchImpl,
    webSocket: ws ? () => ws : undefined
  })
  return { p, calls: srv.calls }
}

/** server that answers like server/src/index.ts */
function chargeServer(state: { status: string }) {
  return (method: string, path: string): { status: number; body: unknown } => {
    if (method === 'POST' && path === '/v1/charges')
      return { status: 201, body: { chargeId: 'ch_1', status: 'pending', paid: false, expiresAt: Date.now() + 120_000, qrImage: QR, amount: 130 } }
    if (method === 'GET' && path === '/v1/charges/ch_1')
      return { status: 200, body: { chargeId: 'ch_1', status: state.status, paid: state.status === 'successful', expiresAt: 0, amount: 130 } }
    if (method === 'POST') return { status: 200, body: {} }
    return { status: 404, body: { error: 'not_found' } }
  }
}

const REQ = { amount: 130, currency: 'THB', qty: 1, reference: '20261121100000', expiresInSec: 120 }

describe('server payment provider (DEC-018)', () => {
  it('health: ok / server says not ready / unreachable', async () => {
    expect(await provider(() => ({ status: 200, body: { ok: true, problems: [] } })).p.health()).toEqual({ ready: true })
    expect(await provider(() => ({ status: 503, body: { ok: false, problems: ['omise: down'] } })).p.health()).toEqual({
      ready: false,
      error: 'payment server: omise: down'
    })
    const down = new ServerPaymentProvider({
      baseUrl: 'https://pay.test', boothId: 'b', boothKey: 'k', pollSec: 3, lateWatchSec: 0,
      fetch: (async () => { throw new Error('ENOTFOUND') }) as typeof fetch
    })
    expect(await down.health()).toEqual({ ready: false, error: 'payment server not reachable: ENOTFOUND' })
  })

  it('createCharge sends sessionId + qty + amount with the booth key, returns the real QR image', async () => {
    const { p, calls } = provider(chargeServer({ status: 'pending' }))
    const c = await p.createCharge(REQ)
    expect(c).toMatchObject({ chargeId: 'ch_1', qrImage: QR })
    expect(calls[0]).toEqual({ method: 'POST', path: '/v1/charges', body: { sessionId: '20261121100000', qty: 1, amount: 130 }, auth: `Bearer booth1.${'k'.repeat(32)}` })
    p.close()
  })

  it('price mismatch (409) → clear error, no QR', async () => {
    const { p } = provider(() => ({ status: 409, body: { error: 'price_mismatch', serverAmount: 150 } }))
    await expect(p.createCharge(REQ)).rejects.toThrow('ราคาในตู้ (130) ไม่ตรงกับ server (150)')
  })

  it('polls until the server says successful → onPaid once; claim is a separate call', async () => {
    vi.useFakeTimers()
    const state = { status: 'pending' }
    const { p, calls } = provider(chargeServer(state))
    const paid: string[] = []
    p.onPaid((id) => paid.push(id))
    await p.createCharge(REQ)
    await vi.advanceTimersByTimeAsync(3000)
    expect(paid).toEqual([])
    state.status = 'successful'
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(9000)
    expect(paid).toEqual(['ch_1'])
    expect(calls.filter((c) => c.path.endsWith('/claim'))).toHaveLength(0) // the machine decides to claim
    await p.claim('ch_1')
    expect(calls.filter((c) => c.path === '/v1/charges/ch_1/claim')).toHaveLength(1)
  })

  it('a final unpaid status (mismatch / failed / expired) stops watching, never pays', async () => {
    vi.useFakeTimers()
    const { p, calls } = provider(chargeServer({ status: 'mismatch' }))
    const paid: string[] = []
    p.onPaid((id) => paid.push(id))
    await p.createCharge(REQ)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(paid).toEqual([])
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
  })

  it('WebSocket push triggers an immediate check — the push alone does not pay', async () => {
    vi.useFakeTimers()
    const ws = new FakeWs()
    const state = { status: 'pending' }
    const { p } = provider(chargeServer(state), ws)
    const paid: string[] = []
    p.onPaid((id) => paid.push(id))
    await p.createCharge(REQ)
    // forged/early push while the server still says pending → nothing
    ws.onmessage!({ data: JSON.stringify({ type: 'charge', chargeId: 'ch_1', status: 'successful' }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(paid).toEqual([])
    state.status = 'successful'
    ws.onmessage!({ data: JSON.stringify({ type: 'charge', chargeId: 'ch_1', status: 'successful' }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(paid).toEqual(['ch_1'])
    expect(ws.closed).toBe(true) // nothing left to watch
  })

  it('after cancel it keeps watching, so late money still reaches the machine (→ orphan record)', async () => {
    vi.useFakeTimers()
    const state = { status: 'pending' }
    const { p, calls } = provider(chargeServer(state))
    const paid: string[] = []
    p.onPaid((id) => paid.push(id))
    await p.createCharge(REQ)
    await p.cancelCharge('ch_1')
    expect(calls.some((c) => c.path === '/v1/charges/ch_1/cancel')).toBe(true)
    state.status = 'successful'
    await vi.advanceTimersByTimeAsync(3000)
    expect(paid).toEqual(['ch_1'])
  })

  it('config: provider server needs baseUrl, boothId, boothKey', () => {
    expect(validateConfig(defaultConfig({ payment: { provider: 'server' } }))).toEqual(
      expect.arrayContaining([
        'payment.server.baseUrl must start with https:// (http:// only for local testing)',
        'payment.server.boothId and boothKey must be set in local.json'
      ])
    )
    expect(validateConfig(defaultConfig({ payment: { provider: 'server', server: { baseUrl: 'https://x', boothId: 'b', boothKey: 'k' } } }))).toEqual([])
  })
})

describe('machine + payment server (DEC-019)', () => {
  it('kiosk: payment not ready → DeviceError before any payment screen', async () => {
    const ctx = setup({ mode: 'kiosk' })
    vi.spyOn(ctx.payment, 'health').mockResolvedValue({ ready: false, error: 'payment server not reachable: offline' })
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    expect(ctx.m.snapshot.state).toBe('DeviceError')
    expect(ctx.m.snapshot.error).toMatchObject({ code: 'PAYMENT_NOT_READY', paid: false })
  })

  it('event mode does not need the payment server', async () => {
    const ctx = setup({ mode: 'event' })
    const health = vi.spyOn(ctx.payment, 'health').mockResolvedValue({ ready: false })
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    expect(ctx.m.snapshot.state).toBe('SelectTemplate')
    expect(health).not.toHaveBeenCalled()
  })

  async function toWaitPayment(ctx: ReturnType<typeof setup>) {
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'CHOOSE_PROMPTPAY' })
    ctx.m.dispatch({ type: 'SELECT_QTY', qty: 1 })
    await tick()
    return ctx.m.snapshot.payment!.chargeId
  }

  it('accepted payment is claimed', async () => {
    const ctx = setup({ mode: 'kiosk' })
    const claim = vi.fn(async () => {})
    Object.assign(ctx.payment, { claim })
    const id = await toWaitPayment(ctx)
    ctx.payment.simulatePaid(id)
    expect(ctx.m.snapshot.state).toBe('SelectTemplate')
    expect(claim).toHaveBeenCalledWith(id)
  })

  it('money arriving after the customer cancelled is NOT claimed → stays on the server for compensation + local orphan record', async () => {
    const ctx = setup({ mode: 'kiosk' })
    const claim = vi.fn(async () => {})
    Object.assign(ctx.payment, { claim })
    const id = await toWaitPayment(ctx)
    ctx.m.dispatch({ type: 'CANCEL_REQUEST' })
    ctx.m.dispatch({ type: 'CONFIRM_CANCEL' })
    await tick()
    expect(ctx.m.snapshot.state).toBe('Idle')
    ctx.payment.simulatePaid(id)
    expect(claim).not.toHaveBeenCalled()
    expect(ctx.store.orphans).toEqual([id])
  })

  it('unclaimed verified payments are logged at start for staff', async () => {
    const ctx = setup({ mode: 'kiosk' })
    Object.assign(ctx.payment, { unclaimed: async () => [{ chargeId: 'ch_9', sessionId: 's9', amount: 130, paidAt: null }] })
    await ctx.m.start()
    await tick()
    expect(ctx.logger.entries.some((l) => l.event === 'payment.unclaimed' && l.data['count'] === 1)).toBe(true)
  })

  it('qty is sent to the provider', async () => {
    const ctx = setup({ mode: 'kiosk' })
    const create = vi.spyOn(ctx.payment, 'createCharge')
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'CHOOSE_PROMPTPAY' })
    ctx.m.dispatch({ type: 'SELECT_QTY', qty: 3 })
    await tick()
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ qty: 3, amount: 375 }))
  })
})
