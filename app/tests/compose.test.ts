import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { composeToFile } from '../src/main/compose'
import { loadTemplates } from '../src/main/templates'
import { matchPreview } from './previewMatch'

const { templates } = loadTemplates(join(__dirname, '../../Templates'))
const tmp = mkdtempSync(join(tmpdir(), 'booth-compose-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('slot positions match the old system preview.png (every real template)', () => {
  it.each(templates.map((t) => [t.id, t] as const))('%s', async (_id, t) => {
    const res = await matchPreview(t)
    for (const r of res) {
      expect.soft(r.precision, `${t.id} photo ${r.photoNumber} precision`).toBeGreaterThanOrEqual(0.975)
      expect.soft(r.recall, `${t.id} photo ${r.photoNumber} recall`).toBeGreaterThanOrEqual(0.975)
    }
  }, 30_000)
})

describe('the preview check really detects wrong placement (negative controls)', () => {
  const base = templates.find((x) => x.id === '2x6-02')!
  const withSlot3 = (patch: Partial<(typeof base.photos)[number]>) => {
    const photos = base.photos.map((p) => (p.photoNumber === 3 ? { ...p, ...patch } : p))
    const elements = base.elements.map((e) => (e.kind === 'photo' && e.photoNumber === 3 ? { ...e, ...patch } : e))
    return { ...base, photos, elements }
  }
  const worst = async (t: typeof base) => {
    const r = (await matchPreview(t)).find((x) => x.photoNumber === 3)!
    return Math.min(r.precision, r.recall)
  }

  it('real rotation (17°) passes', async () => {
    expect(await worst(base)).toBeGreaterThanOrEqual(0.975)
  })
  it('ignoring the rotation fails', async () => {
    expect(await worst(withSlot3({ rotation: 0 }))).toBeLessThan(0.975)
  })
  it('rotating the wrong way fails', async () => {
    expect(await worst(withSlot3({ rotation: -17 }))).toBeLessThan(0.975)
  })
  // Offsets are tested on 4x6-401 (overlay UNDER the photos). On templates whose overlay sits on
  // top (e.g. 2x6-02) a small shift is hidden behind the overlay window — invisible in the print too.
  it('a 30 px offset fails (4x6-401)', async () => {
    const t = templates.find((x) => x.id === '4x6-401')!
    const patch = <E extends { kind: string; x: number }>(e: E): E =>
      e.kind === 'photo' && (e as unknown as { photoNumber: number }).photoNumber === 1 ? { ...e, x: e.x + 30 } : e
    const shifted = { ...t, photos: t.photos.map(patch), elements: t.elements.map(patch) }
    const r = (await matchPreview(shifted)).find((x) => x.photoNumber === 1)!
    expect(Math.min(r.precision, r.recall)).toBeLessThan(0.975)
  })
})

describe('composeToFile', () => {
  it('writes a full-resolution JPEG for 4x6 and 2x6 within the time budget', async () => {
    const photo = join(tmp, 'shot.jpg')
    const c = createCanvas(800, 1200)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#336699'
    ctx.fillRect(0, 0, 800, 1200)
    writeFileSync(photo, await c.encode('jpeg', 90))

    for (const id of ['4x6-601', '2x6-02']) {
      const t = templates.find((x) => x.id === id)!
      const out = join(tmp, `${id}.jpg`)
      const started = Date.now()
      await composeToFile(t, t.photos.map(() => photo), out)
      const ms = Date.now() - started
      const img = await loadImage(out)
      expect([img.width, img.height]).toEqual([t.width, t.height])
      expect(ms).toBeLessThan(15_000) // PRD NFR: capture done → print starts < 15 s
    }
  }, 60_000)

  it('fails clearly when photos are missing', async () => {
    const t = templates.find((x) => x.id === '4x6-601')!
    await expect(composeToFile(t, [], join(tmp, 'x.jpg'))).rejects.toThrow(/needs 6 photos/)
  })
})
