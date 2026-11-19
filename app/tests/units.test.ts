import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deepMerge, validateConfig } from '../src/main/config'
import { FrameCamera } from '../src/main/drivers/camera/frameCamera'
import { buildRelayFrame } from '../src/main/drivers/relay'
import { availableQtys, priceFor } from '../src/main/pricing'
import { FileSessionStore, makeSessionId } from '../src/main/session'
import { defaultConfig } from './helpers'

const tmp: string[] = []
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true })
})
const mkTmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'booth-test-'))
  tmp.push(d)
  return d
}

describe('pricing (PAY-1)', () => {
  const table = { '1': 130, '2': 250, '3': 375, '4': 500 }
  it('returns the table price', () => {
    expect([1, 2, 3, 4].map((q) => priceFor(q, table))).toEqual([130, 250, 375, 500])
  })
  it('rejects unknown / invalid quantities', () => {
    expect(() => priceFor(5, table)).toThrow()
    expect(() => priceFor(0, table)).toThrow()
    expect(() => priceFor(1.5, table)).toThrow()
  })
  it('lists quantities ascending', () => {
    expect(availableQtys({ '3': 1, '1': 1, '2': 1 })).toEqual([1, 2, 3])
  })
})

describe('relay frame (HW-1, protocol from PRD archive 2.4)', () => {
  it('CH2 ON = 33 3C 00 00 00 02 01 72', () => {
    // 0x33+0x3C+0x02+0x01 = 0x72
    expect(buildRelayFrame(2, true).toString('hex')).toBe('333c000000020172')
  })
  it('CH4 OFF = 33 3C 00 00 00 04 02 75', () => {
    expect(buildRelayFrame(4, false).toString('hex')).toBe('333c000000040275')
  })
  it('rejects invalid channels', () => {
    expect(() => buildRelayFrame(0, true)).toThrow()
  })
})

describe('config', () => {
  it('default.json is valid', () => {
    expect(validateConfig(defaultConfig())).toEqual([])
  })
  it('local override merges deeply', () => {
    const c = deepMerge(defaultConfig(), { mode: 'event', timeoutsSec: { showQr: 60 } })
    expect(c.mode).toBe('event')
    expect(c.timeoutsSec.showQr).toBe(60)
    expect(c.timeoutsSec.selectQty).toBe(30)
  })
  it('rejects duplicate template ids (TPL-6)', () => {
    const c = defaultConfig()
    c.templates = [c.templates[0]!, { ...c.templates[0]! }]
    expect(validateConfig(c).join()).toMatch(/duplicate template id/)
  })
  it('rejects bad mode and bad prices', () => {
    const c = defaultConfig({ mode: 'party', prices: { '0': 10, '2': -1 } })
    const errs = validateConfig(c).join('\n')
    expect(errs).toMatch(/mode/)
    expect(errs).toMatch(/positive integer/)
    expect(errs).toMatch(/>= 0/)
  })
})

describe('session store', () => {
  it('session id is yyyyMMddHHmmss local time', () => {
    expect(makeSessionId(new Date(2026, 10, 19, 9, 5, 7))).toBe('20261119090507')
  })
  it('creates folder + session.json; same second gets a unique id', () => {
    const root = mkTmp()
    const store = new FileSessionStore(root)
    const now = new Date(2026, 10, 19, 9, 5, 7)
    const a = store.create('kiosk', now)
    const b = store.create('kiosk', now)
    expect(a.sessionId).toBe('20261119090507')
    expect(b.sessionId).toBe('20261119090507-2')
    expect(existsSync(store.captureDir(a))).toBe(true)
    const saved = JSON.parse(readFileSync(join(root, a.sessionId, 'session.json'), 'utf8'))
    expect(saved.status).toBe('active')
  })
})

describe('frame camera (mock/webcam)', () => {
  it('writes the JPEG frame to disk', async () => {
    const dir = mkTmp()
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const cam = new FrameCamera('mock', async () => jpeg, async () => ({ ready: true }))
    await cam.capture(join(dir, '01.jpg'))
    expect(readFileSync(join(dir, '01.jpg'))).toEqual(jpeg)
  })
  it('refuses non-JPEG data', async () => {
    const cam = new FrameCamera('mock', async () => Buffer.from('nope'), async () => ({ ready: true }))
    await expect(cam.capture(join(mkTmp(), '01.jpg'))).rejects.toThrow(/JPEG/)
  })
  it('forced not-ready for testing CAM-8', async () => {
    const cam = new FrameCamera('mock', async () => Buffer.alloc(0), async () => ({ ready: true }), { forceNotReady: true })
    expect((await cam.detect()).ready).toBe(false)
  })
})
