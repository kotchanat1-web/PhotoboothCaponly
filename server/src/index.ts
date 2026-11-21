// Photobooth payment verification server (DEC-018, DEC-019).
// The booth never decides that money arrived: only this server does, after checking the charge with Omise.
import type { AppEnv } from './env'
import { Omise, OmiseApiError, type OmiseCharge } from './omise'
import { isFinal, judgeCharge, satangFromBaht, sha256Hex, constantTimeEqual, verifyOmiseSignature, type ChargeRow } from './verify'

export { BoothHub } from './hub'

const CURRENCY = 'THB'
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
/** booth GET /v1/charges/:id refreshes from Omise at most this often (webhook is the fast path) */
const REFRESH_MIN_MS = 5000

type Booth = { id: string; name: string }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
const fail = (status: number, code: string, message?: string) => json({ error: code, message: message ?? code }, status)

const nowIso = () => new Date().toISOString()

function omise(env: AppEnv): Omise | null {
  return env.OMISE_SECRET_KEY ? new Omise(env.OMISE_API_BASE, env.OMISE_SECRET_KEY) : null
}

async function audit(env: AppEnv, event: string, p: { boothId?: string | null; chargeId?: string | null; detail?: unknown } = {}): Promise<void> {
  const detail = p.detail === undefined ? null : typeof p.detail === 'string' ? p.detail : JSON.stringify(p.detail)
  await env.DB.prepare('INSERT INTO audit (at, booth_id, charge_id, event, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(nowIso(), p.boothId ?? null, p.chargeId ?? null, event, detail)
    .run()
}

/** ADM-7: Authorization: Bearer <boothId>.<key> — only the SHA-256 of the key is stored. */
async function authBooth(req: Request, env: AppEnv): Promise<Booth | null> {
  const m = /^Bearer ([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{16,128})$/.exec(req.headers.get('Authorization') ?? '')
  if (!m) return null
  const row = await env.DB.prepare('SELECT id, name, key_hash, active FROM booths WHERE id = ?').bind(m[1]).first<{ id: string; name: string; key_hash: string; active: number }>()
  if (!row || row.active !== 1) return null
  return constantTimeEqual(await sha256Hex(m[2]!), row.key_hash) ? { id: row.id, name: row.name } : null
}

async function getCharge(env: AppEnv, id: string): Promise<ChargeRow | null> {
  return env.DB.prepare('SELECT * FROM charges WHERE id = ?').bind(id).first<ChargeRow>()
}

async function notifyBooth(env: AppEnv, boothId: string, chargeId: string, status: string): Promise<void> {
  try {
    await env.BOOTH_HUB.get(env.BOOTH_HUB.idFromName(boothId)).notify({ type: 'charge', chargeId, status })
  } catch {
    // push is best effort — the booth also polls GET /v1/charges/:id
  }
}

/**
 * Fetch the charge from Omise and apply the money rules (judgeCharge). Never moves a final status.
 * Returns the row as stored afterwards.
 */
async function refreshFromOmise(env: AppEnv, row: ChargeRow, why: string, fetched?: OmiseCharge): Promise<ChargeRow> {
  if (isFinal(row.status) || !row.omise_charge_id) return row
  const client = omise(env)
  if (!client) return row
  let oc: OmiseCharge
  try {
    oc = fetched ?? (await client.getCharge(row.omise_charge_id))
  } catch (e) {
    await audit(env, 'omise.fetch_failed', { boothId: row.booth_id, chargeId: row.id, detail: { why, error: String(e) } })
    return row
  }
  const j = judgeCharge(row, oc)
  const checked = nowIso()
  if (j.status === 'pending') {
    await env.DB.prepare('UPDATE charges SET last_checked_at = ? WHERE id = ?').bind(checked, row.id).run()
    return { ...row, last_checked_at: checked }
  }
  const failure = j.status === 'successful' ? null : j.reason
  const paidAt = j.status === 'successful' ? j.paidAt : null
  // guarded update: only a non-final row can change (two webhooks racing → one wins, same result)
  const res = await env.DB.prepare(
    `UPDATE charges SET status = ?, failure = ?, paid_at = ?, last_checked_at = ?
     WHERE id = ? AND status IN ('creating', 'pending')`
  )
    .bind(j.status, failure, paidAt, checked, row.id)
    .run()
  if (res.meta.changes === 0) return (await getCharge(env, row.id)) ?? row
  await audit(env, `charge.${j.status}`, { boothId: row.booth_id, chargeId: row.id, detail: { why, omise: oc.id, omiseStatus: oc.status, amount: oc.amount, failure } })
  if (j.status === 'successful' && row.cancel_requested_at) {
    // PromptPay cannot be refunded through Omise → staff must compensate (listed by /v1/charges/unclaimed)
    await audit(env, 'charge.paid_after_cancel', { boothId: row.booth_id, chargeId: row.id, detail: { cancelRequestedAt: row.cancel_requested_at } })
  }
  await notifyBooth(env, row.booth_id, row.id, j.status)
  return { ...row, status: j.status, failure, paid_at: paidAt, last_checked_at: checked }
}

function publicCharge(r: ChargeRow) {
  return {
    chargeId: r.id,
    sessionId: r.session_id,
    qty: r.qty,
    amount: r.amount_satang / 100,
    currency: r.currency,
    status: r.status,
    paid: r.status === 'successful',
    expiresAt: r.expires_at ? Date.parse(r.expires_at) : null,
    paidAt: r.paid_at,
    cancelRequested: r.cancel_requested_at !== null,
    claimed: r.claimed_at !== null
  }
}

// ------------------------------------------------------------------------------------------------ routes

/** Pre-payment check (BR-01 extension, DEC-019): database + Omise key + Omise reachable. */
async function health(env: AppEnv, booth: Booth): Promise<Response> {
  const problems: string[] = []
  try {
    await env.DB.prepare('SELECT 1').first()
  } catch (e) {
    problems.push(`database: ${String(e)}`)
  }
  const client = omise(env)
  if (!client) problems.push('OMISE_SECRET_KEY not set')
  else {
    try {
      await client.ping()
    } catch (e) {
      problems.push(`omise: ${String(e)}`)
    }
  }
  if (!env.OMISE_WEBHOOK_SECRET) problems.push('OMISE_WEBHOOK_SECRET not set')
  return json({ ok: problems.length === 0, booth: booth.id, problems, time: nowIso() }, problems.length ? 503 : 200)
}

async function createCharge(req: Request, env: AppEnv, booth: Booth): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { sessionId?: unknown; qty?: unknown; amount?: unknown } | null
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  const qty = typeof body?.qty === 'number' ? body.qty : NaN
  const boothAmount = typeof body?.amount === 'number' ? body.amount : NaN
  if (!SAFE_ID.test(sessionId)) return fail(400, 'invalid_session_id')
  if (!Number.isInteger(qty) || qty < 1) return fail(400, 'invalid_qty')

  // DEC-019: the server price decides; the booth's amount is only cross-checked
  const price = await env.DB.prepare('SELECT amount_satang FROM prices WHERE qty = ?').bind(qty).first<{ amount_satang: number }>()
  if (!price) return fail(400, 'invalid_qty', `no price for qty ${qty}`)
  if (satangFromBaht(boothAmount) !== price.amount_satang) {
    await audit(env, 'charge.price_mismatch', { boothId: booth.id, detail: { sessionId, qty, boothAmount, serverSatang: price.amount_satang } })
    return json({ error: 'price_mismatch', message: 'booth price differs from server price', serverAmount: price.amount_satang / 100 }, 409)
  }
  const client = omise(env)
  if (!client) return fail(503, 'omise_not_configured')

  const id = `ch_${crypto.randomUUID().replace(/-/g, '')}`
  const created = new Date()
  const expiresAt = new Date(created.getTime() + Number(env.QR_EXPIRY_SEC) * 1000)
  await env.DB.prepare(
    `INSERT INTO charges (id, booth_id, session_id, qty, amount_satang, currency, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?)`
  )
    .bind(id, booth.id, sessionId, qty, price.amount_satang, CURRENCY, created.toISOString(), expiresAt.toISOString())
    .run()

  let oc: OmiseCharge
  let qrImage: string
  try {
    oc = await client.createPromptPayCharge({
      amountSatang: price.amount_satang,
      currency: CURRENCY,
      refId: id,
      expiresAt,
      description: `photobooth ${booth.id} session ${sessionId}`,
      metadata: { charge_id: id, booth_id: booth.id, session_id: sessionId }
    })
    const uri = oc.source?.scannable_code?.image?.download_uri
    if (!uri) throw new OmiseApiError(502, 'no_qr', 'charge has no scannable_code image')
    // store the Omise id before anything else can fail, so the charge can always be reconciled
    await env.DB.prepare(`UPDATE charges SET omise_charge_id = ?, status = 'pending' WHERE id = ?`).bind(oc.id, id).run()
    qrImage = await client.qrDataUrl(uri)
  } catch (e) {
    const known = await getCharge(env, id)
    if (!known?.omise_charge_id) await env.DB.prepare(`UPDATE charges SET status = 'error', failure = ? WHERE id = ?`).bind(String(e), id).run()
    await audit(env, 'charge.create_failed', { boothId: booth.id, chargeId: id, detail: String(e) })
    return fail(502, 'omise_create_failed', String(e))
  }
  await audit(env, 'charge.created', { boothId: booth.id, chargeId: id, detail: { omise: oc.id, sessionId, qty, amountSatang: price.amount_satang } })
  return json({ ...publicCharge({ ...(await getCharge(env, id))! }), qrImage }, 201)
}

async function ownCharge(env: AppEnv, booth: Booth, id: string): Promise<ChargeRow | Response> {
  if (!SAFE_ID.test(id)) return fail(400, 'invalid_charge_id')
  const row = await getCharge(env, id)
  // another booth's charge looks exactly like a missing one
  if (!row || row.booth_id !== booth.id) return fail(404, 'not_found')
  return row
}

async function chargeStatus(env: AppEnv, booth: Booth, id: string): Promise<Response> {
  let row = await ownCharge(env, booth, id)
  if (row instanceof Response) return row
  const last = row.last_checked_at ? Date.parse(row.last_checked_at) : 0
  if (!isFinal(row.status) && Date.now() - last >= REFRESH_MIN_MS) row = await refreshFromOmise(env, row, 'booth_poll')
  return json(publicCharge(row))
}

/** PromptPay cannot be cancelled at Omise: we only remember the booth gave up, and keep watching for late money. */
async function cancelCharge(env: AppEnv, booth: Booth, id: string): Promise<Response> {
  const row = await ownCharge(env, booth, id)
  if (row instanceof Response) return row
  if (!row.cancel_requested_at) {
    await env.DB.prepare('UPDATE charges SET cancel_requested_at = ? WHERE id = ? AND cancel_requested_at IS NULL').bind(nowIso(), id).run()
    await audit(env, 'charge.cancel_requested', { boothId: booth.id, chargeId: id, detail: { status: row.status } })
  }
  return json(publicCharge((await getCharge(env, id))!))
}

/** The booth started the service for this payment (BR-02): it no longer needs compensation. */
async function claimCharge(env: AppEnv, booth: Booth, id: string): Promise<Response> {
  const row = await ownCharge(env, booth, id)
  if (row instanceof Response) return row
  if (row.status !== 'successful') return fail(409, 'not_paid', `status is ${row.status}`)
  if (!row.claimed_at) {
    await env.DB.prepare('UPDATE charges SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL').bind(nowIso(), id).run()
    await audit(env, 'charge.claimed', { boothId: booth.id, chargeId: id })
  }
  return json(publicCharge((await getCharge(env, id))!))
}

/** PAY-7 / BR-02: verified payments this booth never used (crash, paid after cancel) → staff compensates. */
async function unclaimed(env: AppEnv, booth: Booth): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM charges WHERE booth_id = ? AND status = 'successful' AND claimed_at IS NULL ORDER BY created_at`
  )
    .bind(booth.id)
    .all<ChargeRow>()
  return json({ charges: results.map(publicCharge) })
}

async function prices(env: AppEnv): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT qty, amount_satang FROM prices ORDER BY qty').all<{ qty: number; amount_satang: number }>()
  return json({ currency: CURRENCY, prices: Object.fromEntries(results.map((r) => [String(r.qty), r.amount_satang / 100])) })
}

/** Omise → us. Signature first, then re-fetch the charge from Omise (docs recommend an independent GET). */
async function webhook(req: Request, env: AppEnv): Promise<Response> {
  const raw = await req.text()
  if (!env.OMISE_WEBHOOK_SECRET) {
    await audit(env, 'webhook.rejected', { detail: 'OMISE_WEBHOOK_SECRET not set' })
    return fail(503, 'webhook_secret_not_set')
  }
  const ok = await verifyOmiseSignature({
    rawBody: raw,
    signature: req.headers.get('Omise-Signature'),
    timestamp: req.headers.get('Omise-Signature-Timestamp'),
    secretBase64: env.OMISE_WEBHOOK_SECRET,
    nowSec: Math.floor(Date.now() / 1000)
  })
  if (!ok) {
    await audit(env, 'webhook.bad_signature', { detail: raw.slice(0, 300) })
    return fail(401, 'bad_signature')
  }
  const ev = JSON.parse(raw) as { key?: string; data?: { object?: string; id?: string } }
  const omiseId = ev.data?.object === 'charge' ? ev.data.id : undefined
  if (!ev.key?.startsWith('charge.') || !omiseId) return json({ ignored: ev.key ?? 'unknown' })
  const row = await env.DB.prepare('SELECT * FROM charges WHERE omise_charge_id = ?').bind(omiseId).first<ChargeRow>()
  if (!row) {
    await audit(env, 'webhook.unknown_charge', { detail: { key: ev.key, omiseId } })
    return json({ ignored: 'unknown charge' })
  }
  // the webhook body itself is NOT trusted for the amount/status — refreshFromOmise fetches the charge again
  const after = await refreshFromOmise(env, row, `webhook ${ev.key}`)
  return json({ chargeId: after.id, status: after.status })
}

/** Cron: catch webhooks that never arrived; give up on charges long past expiry. */
export async function reconcile(env: AppEnv): Promise<{ checked: number; expired: number }> {
  const grace = (Number(env.QR_EXPIRY_SEC) + Number(env.LATE_GRACE_SEC)) * 1000
  const { results } = await env.DB.prepare(`SELECT * FROM charges WHERE status = 'pending' ORDER BY created_at LIMIT 50`).all<ChargeRow>()
  let checked = 0
  let expired = 0
  for (const row of results) {
    const after = await refreshFromOmise(env, row, 'cron')
    checked++
    if (after.status === 'pending' && Date.now() - Date.parse(row.created_at) > grace) {
      const r = await env.DB.prepare(`UPDATE charges SET status = 'expired', failure = 'no result from Omise within grace' WHERE id = ? AND status = 'pending'`)
        .bind(row.id)
        .run()
      if (r.meta.changes) {
        expired++
        await audit(env, 'charge.expired', { boothId: row.booth_id, chargeId: row.id, detail: 'still pending after expiry + grace' })
        await notifyBooth(env, row.booth_id, row.id, 'expired')
      }
    }
  }
  return { checked, expired }
}

export default {
  async fetch(req: Request, env: AppEnv): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    try {
      if (req.method === 'POST' && path === '/webhooks/omise') return await webhook(req, env)

      if (!path.startsWith('/v1/')) return fail(404, 'not_found')
      const booth = await authBooth(req, env)
      if (!booth) return fail(401, 'unauthorized')

      if (path === '/v1/ws') {
        if (req.headers.get('Upgrade') !== 'websocket') return fail(426, 'expected_websocket')
        return env.BOOTH_HUB.get(env.BOOTH_HUB.idFromName(booth.id)).fetch(req)
      }
      if (req.method === 'GET' && path === '/v1/health') return await health(env, booth)
      if (req.method === 'GET' && path === '/v1/prices') return await prices(env)
      if (req.method === 'POST' && path === '/v1/charges') return await createCharge(req, env, booth)
      if (req.method === 'GET' && path === '/v1/charges/unclaimed') return await unclaimed(env, booth)
      const m = /^\/v1\/charges\/([^/]+)(\/cancel|\/claim)?$/.exec(path)
      if (m) {
        const id = decodeURIComponent(m[1]!)
        if (req.method === 'GET' && !m[2]) return await chargeStatus(env, booth, id)
        if (req.method === 'POST' && m[2] === '/cancel') return await cancelCharge(env, booth, id)
        if (req.method === 'POST' && m[2] === '/claim') return await claimCharge(env, booth, id)
      }
      return fail(404, 'not_found')
    } catch (e) {
      try {
        await audit(env, 'server.error', { detail: { path, error: String(e) } })
      } catch {
        // database down too
      }
      return fail(500, 'server_error')
    }
  },

  async scheduled(_c: ScheduledController, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(reconcile(env).then(() => undefined))
  }
} satisfies ExportedHandler<AppEnv>
