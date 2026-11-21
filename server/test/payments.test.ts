import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcile } from '../src/index'
import type { OmiseCharge } from '../src/omise'
import { constantTimeEqual, judgeCharge, verifyOmiseSignature, type ChargeRow } from '../src/verify'
import {
  E,
  KEY_A,
  KEY_B,
  addBooth,
  auditEvents,
  call,
  chargeEvent,
  createCharge,
  installFakeOmise,
  omiseIdOf,
  signedWebhook,
  type FakeOmise
} from './helpers'

let omise: FakeOmise
beforeEach(async () => {
  vi.restoreAllMocks()
  omise = installFakeOmise()
  await E.DB.exec('DELETE FROM audit; DELETE FROM charges; DELETE FROM booths;')
  await addBooth('A', KEY_A)
  await addBooth('B', KEY_B)
})

// ------------------------------------------------------------------------------------------ pure money rules

const row: ChargeRow = {
  id: 'ch_1', booth_id: 'A', session_id: 's1', qty: 1, amount_satang: 13000, currency: 'THB', omise_charge_id: 'chrg_1',
  status: 'pending', failure: null, created_at: '', expires_at: null, paid_at: null, cancel_requested_at: null, claimed_at: null, last_checked_at: null
}
const oc = (over: Partial<OmiseCharge> = {}): OmiseCharge => ({
  object: 'charge', id: 'chrg_1', amount: 13000, currency: 'thb', status: 'successful', paid: true, paid_at: '2026-11-21T03:00:00Z',
  metadata: { charge_id: 'ch_1' }, ...over
})

describe('judgeCharge — known answers (BR-07 / DEC-019)', () => {
  it('successful + paid + 13000 satang THB + same ids → paid', () => {
    expect(judgeCharge(row, oc())).toEqual({ status: 'successful', paidAt: '2026-11-21T03:00:00Z' })
  })
  it('anything inconsistent is a mismatch, never paid', () => {
    expect(judgeCharge(row, oc({ paid: false })).status).toBe('mismatch')
    expect(judgeCharge(row, oc({ amount: 12999 })).status).toBe('mismatch')
    expect(judgeCharge(row, oc({ amount: 130 })).status).toBe('mismatch') // baht instead of satang
    expect(judgeCharge(row, oc({ currency: 'usd' })).status).toBe('mismatch')
    expect(judgeCharge(row, oc({ id: 'chrg_other' })).status).toBe('mismatch')
    expect(judgeCharge(row, oc({ metadata: { charge_id: 'ch_other' } })).status).toBe('mismatch')
    expect(judgeCharge(row, oc({ status: 'weird' })).status).toBe('mismatch')
  })
  it('pending / expired / failed / reversed', () => {
    expect(judgeCharge(row, oc({ status: 'pending', paid: false })).status).toBe('pending')
    expect(judgeCharge(row, oc({ status: 'expired', paid: false })).status).toBe('expired')
    expect(judgeCharge(row, oc({ status: 'failed', paid: false, failure_code: 'payment_cancelled' }))).toEqual({ status: 'failed', reason: 'payment_cancelled' })
    expect(judgeCharge(row, oc({ status: 'reversed' })).status).toBe('failed')
  })
})

describe('webhook signature (Omise-Signature, HMAC-SHA256)', () => {
  const secret = btoa('s3cret')
  async function sign(ts: string, body: string, s = secret) {
    const k = await crypto.subtle.importKey('raw', Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${ts}.${body}`)))].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  it('accepts a correct signature, also among two during secret rotation', async () => {
    const sig = await sign('1000', '{"a":1}')
    expect(await verifyOmiseSignature({ rawBody: '{"a":1}', signature: sig, timestamp: '1000', secretBase64: secret, nowSec: 1100 })).toBe(true)
    expect(await verifyOmiseSignature({ rawBody: '{"a":1}', signature: `${'0'.repeat(64)},${sig}`, timestamp: '1000', secretBase64: secret, nowSec: 1100 })).toBe(true)
  })
  it('rejects tampered body, wrong secret, old timestamp, missing headers', async () => {
    const sig = await sign('1000', '{"a":1}')
    expect(await verifyOmiseSignature({ rawBody: '{"a":2}', signature: sig, timestamp: '1000', secretBase64: secret, nowSec: 1000 })).toBe(false)
    expect(await verifyOmiseSignature({ rawBody: '{"a":1}', signature: await sign('1000', '{"a":1}', btoa('other')), timestamp: '1000', secretBase64: secret, nowSec: 1000 })).toBe(false)
    expect(await verifyOmiseSignature({ rawBody: '{"a":1}', signature: sig, timestamp: '1000', secretBase64: secret, nowSec: 1000 + 301 })).toBe(false)
    expect(await verifyOmiseSignature({ rawBody: '{"a":1}', signature: null, timestamp: '1000', secretBase64: secret, nowSec: 1000 })).toBe(false)
  })
  it('constant-time compare', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'ab')).toBe(false)
  })
})

// ------------------------------------------------------------------------------------------ HTTP API

describe('booth authentication (ADM-7)', () => {
  it('no key / wrong key / inactive booth → 401', async () => {
    expect((await call('GET', '/v1/prices', { booth: null })).status).toBe(401)
    expect((await call('GET', '/v1/prices', { booth: ['A', 'wrong-key-0000000000'] })).status).toBe(401)
    await addBooth('C', 'booth-c-secret-key-0003', 0)
    expect((await call('GET', '/v1/prices', { booth: ['C', 'booth-c-secret-key-0003'] })).status).toBe(401)
    expect((await call('GET', '/v1/prices')).status).toBe(200)
  })
})

describe('health — checked before the booth shows any payment screen', () => {
  it('ok when database, Omise key and Omise are reachable', async () => {
    const r = await call('GET', '/v1/health')
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, booth: 'A', problems: [] })
  })
  it('503 when Omise is down', async () => {
    omise.down = true
    const r = await call('GET', '/v1/health')
    expect(r.status).toBe(503)
    expect(((await r.json()) as { problems: string[] }).problems[0]).toMatch(/^omise: /)
  })
})

describe('create charge — the server decides the price (DEC-019)', () => {
  it('1 ใบ = 130 บาท = 13000 satang; QR image returned; ref_id + metadata + expires_at sent to Omise', async () => {
    const before = Date.now()
    const { res, body } = await createCharge(1, 130)
    expect(res.status).toBe(201)
    expect(body).toMatchObject({ qty: 1, amount: 130, currency: 'THB', status: 'pending', paid: false })
    expect(body.qrImage).toMatch(/^data:image\/svg\+xml;base64,/)
    const f = omise.forms[0]!
    expect(f.get('amount')).toBe('13000')
    expect(f.get('currency')).toBe('THB')
    expect(f.get('source[type]')).toBe('promptpay')
    expect(f.get('ref_id')).toBe(body.chargeId)
    expect(f.get('metadata[charge_id]')).toBe(body.chargeId)
    expect(f.get('metadata[booth_id]')).toBe('A')
    const exp = Date.parse(f.get('expires_at')!)
    expect(exp).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + 119_000)
    expect(exp).toBeLessThanOrEqual(Date.now() + 121_000)
  })
  it('2 ใบ = 250 บาท = 25000 satang', async () => {
    await createCharge(2, 250)
    expect(omise.forms[0]!.get('amount')).toBe('25000')
  })
  it('booth price differs from server price → 409, nothing sent to Omise', async () => {
    const { res, body } = await createCharge(1, 100)
    expect(res.status).toBe(409)
    expect(body).toMatchObject({ error: 'price_mismatch', serverAmount: 130 })
    expect(omise.forms).toHaveLength(0)
  })
  it('qty without a price / bad session id → 400', async () => {
    expect((await createCharge(9, 1000)).res.status).toBe(400)
    expect((await createCharge(1, 130, '../etc')).res.status).toBe(400)
  })
  it('Omise refuses → 502 and the row is kept as "error" for the audit trail', async () => {
    omise.createError = 'promptpay not enabled'
    const { res } = await createCharge()
    expect(res.status).toBe(502)
    const r = await E.DB.prepare('SELECT status FROM charges').first<{ status: string }>()
    expect(r!.status).toBe('error')
  })
})

describe('payment confirmation', () => {
  it('webhook → server re-fetches the charge from Omise → paid → booth sees it → claim', async () => {
    const { body } = await createCharge()
    const oid = await omiseIdOf(body.chargeId)
    omise.pay(oid)
    const callsBefore = omise.calls.length
    const w = await signedWebhook(chargeEvent(oid))
    expect(w.status).toBe(200)
    expect(omise.calls.slice(callsBefore)).toContain(`GET /charges/${oid}`) // independent GET, not the webhook body
    const st = (await (await call('GET', `/v1/charges/${body.chargeId}`)).json()) as { status: string; paid: boolean }
    expect(st).toMatchObject({ status: 'successful', paid: true })
    expect((await call('POST', `/v1/charges/${body.chargeId}/claim`)).status).toBe(200)
    expect(await auditEvents(body.chargeId)).toEqual(['charge.created', 'charge.successful', 'charge.claimed'])
  })

  it('a correctly signed webhook still cannot pay if Omise says the charge is pending', async () => {
    const { body } = await createCharge()
    const oid = await omiseIdOf(body.chargeId)
    await signedWebhook(chargeEvent(oid))
    const st = (await (await call('GET', `/v1/charges/${body.chargeId}`)).json()) as { paid: boolean }
    expect(st.paid).toBe(false)
  })

  it('bad signature → 401, nothing changes even if the money is there', async () => {
    const { body } = await createCharge()
    const oid = await omiseIdOf(body.chargeId)
    omise.pay(oid)
    expect((await signedWebhook(chargeEvent(oid), { tamper: true })).status).toBe(401)
    expect((await signedWebhook(chargeEvent(oid), { secretB64: btoa('attacker') })).status).toBe(401)
    expect((await signedWebhook(chargeEvent(oid), { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401)
    const r = await E.DB.prepare('SELECT status FROM charges WHERE id = ?').bind(body.chargeId).first<{ status: string }>()
    expect(r!.status).toBe('pending')
  })

  it('Omise amount differs from what we asked → mismatch, never paid, claim refused', async () => {
    const { body } = await createCharge()
    const oid = await omiseIdOf(body.chargeId)
    omise.pay(oid, { amount: 100 })
    await signedWebhook(chargeEvent(oid))
    const st = (await (await call('GET', `/v1/charges/${body.chargeId}`)).json()) as { status: string; paid: boolean }
    expect(st).toMatchObject({ status: 'mismatch', paid: false })
    expect((await call('POST', `/v1/charges/${body.chargeId}/claim`)).status).toBe(409)
  })

  it('duplicate webhooks are harmless (one "charge.successful" in the audit)', async () => {
    const { body } = await createCharge()
    const oid = await omiseIdOf(body.chargeId)
    omise.pay(oid)
    await signedWebhook(chargeEvent(oid))
    await signedWebhook(chargeEvent(oid))
    expect((await auditEvents(body.chargeId)).filter((e) => e === 'charge.successful')).toHaveLength(1)
  })

  it('final status never changes: a later "failed" at Omise cannot undo a verified payment', async () => {
    const { body } = await createCharge()
    const oid = await omiseIdOf(body.chargeId)
    omise.pay(oid)
    await signedWebhook(chargeEvent(oid))
    omise.charges.get(oid)!.status = 'failed'
    await signedWebhook(chargeEvent(oid))
    const r = await E.DB.prepare('SELECT status FROM charges WHERE id = ?').bind(body.chargeId).first<{ status: string }>()
    expect(r!.status).toBe('successful')
  })

  it('webhook lost → the booth poll (GET) or the cron finds the payment at Omise', async () => {
    const a = await createCharge(1, 130, 's-poll')
    const b = await createCharge(1, 130, 's-cron')
    omise.pay(await omiseIdOf(a.body.chargeId))
    omise.pay(await omiseIdOf(b.body.chargeId))
    // booth poll: GET refreshes from Omise (rate-limited to once per 5 s per charge — first call refreshes)
    expect(((await (await call('GET', `/v1/charges/${a.body.chargeId}`)).json()) as { paid: boolean }).paid).toBe(true)
    // cron
    const r = await reconcile(E)
    expect(r.checked).toBe(1)
    const st = await E.DB.prepare('SELECT status FROM charges WHERE id = ?').bind(b.body.chargeId).first<{ status: string }>()
    expect(st!.status).toBe('successful')
  })

  it('cron gives up on a charge still pending after expiry + grace', async () => {
    const { body } = await createCharge()
    await E.DB.prepare('UPDATE charges SET created_at = ? WHERE id = ?').bind(new Date(Date.now() - 3600_000).toISOString(), body.chargeId).run()
    expect(await reconcile(E)).toEqual({ checked: 1, expired: 1 })
    expect(await auditEvents(body.chargeId)).toContain('charge.expired')
  })
})

describe('cancel + late payment (PromptPay cannot be cancelled or refunded via Omise)', () => {
  it('money after the booth gave up → still verified, flagged paid_after_cancel, listed as unclaimed for compensation', async () => {
    const { body } = await createCharge()
    const c = (await (await call('POST', `/v1/charges/${body.chargeId}/cancel`)).json()) as { cancelRequested: boolean; status: string }
    expect(c).toMatchObject({ cancelRequested: true, status: 'pending' })
    const oid = await omiseIdOf(body.chargeId)
    omise.pay(oid)
    await signedWebhook(chargeEvent(oid))
    expect(await auditEvents(body.chargeId)).toEqual(['charge.created', 'charge.cancel_requested', 'charge.successful', 'charge.paid_after_cancel'])
    const u = (await (await call('GET', '/v1/charges/unclaimed')).json()) as { charges: { chargeId: string; amount: number }[] }
    expect(u.charges).toMatchObject([{ chargeId: body.chargeId, amount: 130 }])
    // staff gave the service → booth claims → no longer listed
    await call('POST', `/v1/charges/${body.chargeId}/claim`)
    expect(((await (await call('GET', '/v1/charges/unclaimed')).json()) as { charges: unknown[] }).charges).toEqual([])
  })
})

describe('booths cannot see each other', () => {
  it('booth B gets 404 for booth A charge (status, cancel, claim) and an empty unclaimed list', async () => {
    const { body } = await createCharge()
    const oid = await omiseIdOf(body.chargeId)
    omise.pay(oid)
    await signedWebhook(chargeEvent(oid))
    const B: [string, string] = ['B', KEY_B]
    expect((await call('GET', `/v1/charges/${body.chargeId}`, { booth: B })).status).toBe(404)
    expect((await call('POST', `/v1/charges/${body.chargeId}/cancel`, { booth: B })).status).toBe(404)
    expect((await call('POST', `/v1/charges/${body.chargeId}/claim`, { booth: B })).status).toBe(404)
    expect(((await (await call('GET', '/v1/charges/unclaimed', { booth: B })).json()) as { charges: unknown[] }).charges).toEqual([])
  })
})

describe('push to booth (WebSocket via Durable Object)', () => {
  it('the booth socket gets "charge X successful" right after the verified webhook', async () => {
    const res = await call('GET', '/v1/ws', { headers: { Upgrade: 'websocket' } })
    expect(res.status).toBe(101)
    const ws = res.webSocket!
    ws.accept()
    const got = new Promise<string>((resolve) => ws.addEventListener('message', (e) => resolve(String(e.data))))
    const { body } = await createCharge()
    const oid = await omiseIdOf(body.chargeId)
    omise.pay(oid)
    await signedWebhook(chargeEvent(oid))
    expect(JSON.parse(await got)).toEqual({ type: 'charge', chargeId: body.chargeId, status: 'successful' })
    ws.close()
  })
})
