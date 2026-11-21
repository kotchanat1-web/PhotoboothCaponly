// LOCAL TESTING ONLY — a tiny stand-in for api.omise.co so the whole chain (booth → server → "Omise" → webhook)
// can run on one PC without any account. Never deploy this.
//   MOCK_WEBHOOK_SECRET=<base64> node scripts/mock-omise.mjs
//   POST http://127.0.0.1:8790/_test/pay/<chrg id>[?webhook=0]   → customer "pays" (+ signed webhook unless webhook=0)
//   GET  http://127.0.0.1:8790/_test/charges                    → list
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_OMISE_PORT ?? 8790)
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? 'http://127.0.0.1:8787/webhooks/omise'
const SECRET = process.env.MOCK_WEBHOOK_SECRET
if (!SECRET) {
  console.error('set MOCK_WEBHOOK_SECRET (same Base64 value as OMISE_WEBHOOK_SECRET in server/.dev.vars)')
  process.exit(1)
}
const charges = new Map()
const refIds = new Set()
let n = 0

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}
const err = (res, status, code, message) => send(res, status, { object: 'error', code, message })

async function webhook(charge) {
  const body = JSON.stringify({ object: 'event', id: `evnt_test_${Date.now()}`, key: 'charge.complete', data: charge })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', Buffer.from(SECRET, 'base64')).update(`${ts}.${body}`).digest('hex')
  const r = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Omise-Signature': sig, 'Omise-Signature-Timestamp': ts }, body })
  console.log(`webhook → ${r.status} ${await r.text()}`)
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  let raw = ''
  for await (const c of req) raw += c
  console.log(req.method, url.pathname)
  if (url.pathname.startsWith('/_test/')) {
    const pay = /^\/_test\/pay\/(.+)$/.exec(url.pathname)
    if (req.method === 'POST' && pay) {
      const c = charges.get(pay[1])
      if (!c) return err(res, 404, 'not_found', 'no charge')
      Object.assign(c, { status: 'successful', paid: true, paid_at: new Date().toISOString() })
      if (url.searchParams.get('webhook') !== '0') await webhook(c)
      return send(res, 200, c)
    }
    if (url.pathname === '/_test/charges') return send(res, 200, [...charges.values()])
    return err(res, 404, 'not_found', url.pathname)
  }
  if (!req.headers.authorization?.startsWith('Basic ')) return err(res, 401, 'authentication_failure', 'no key')
  if (req.method === 'GET' && url.pathname === '/account') return send(res, 200, { object: 'account', id: 'acct_mock' })
  if (req.method === 'POST' && url.pathname === '/charges') {
    const f = new URLSearchParams(raw)
    const ref = f.get('ref_id')
    if (refIds.has(ref)) return err(res, 400, 'bad_request', 'ref_id already used')
    refIds.add(ref)
    const id = `chrg_test_mock${++n}`
    const metadata = {}
    for (const [k, v] of f) {
      const m = /^metadata\[(.+)\]$/.exec(k)
      if (m) metadata[m[1]] = v
    }
    const c = {
      object: 'charge', id, amount: Number(f.get('amount')), currency: (f.get('currency') ?? '').toLowerCase(),
      status: 'pending', paid: false, expires_at: f.get('expires_at'), metadata,
      source: { type: 'promptpay', scannable_code: { image: { download_uri: `http://127.0.0.1:${PORT}/qr/${id}` } } }
    }
    charges.set(id, c)
    console.log(`  charge ${id} ${c.amount} satang (${f.get('description')})`)
    return send(res, 200, c)
  }
  const qr = /^\/qr\/(.+)$/.exec(url.pathname)
  if (req.method === 'GET' && qr) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#fff"/><rect x="20" y="20" width="80" height="80" fill="#000"/><rect x="200" y="20" width="80" height="80" fill="#000"/><rect x="20" y="200" width="80" height="80" fill="#000"/><text x="150" y="160" font-size="16" text-anchor="middle">MOCK OMISE ${qr[1]}</text></svg>`
    return send(res, 200, svg, 'image/svg+xml')
  }
  const ch = /^\/charges\/(.+)$/.exec(url.pathname)
  if (req.method === 'GET' && ch) {
    const c = charges.get(ch[1])
    return c ? send(res, 200, c) : err(res, 404, 'not_found', 'no charge')
  }
  return err(res, 404, 'not_found', url.pathname)
}).listen(PORT, '127.0.0.1', () => console.log(`mock Omise on http://127.0.0.1:${PORT} → webhooks to ${WEBHOOK_URL}`))
