import { createCanvas, loadImage } from '@napi-rs/canvas'
import { renderTemplate } from '../src/main/compose'
import type { TemplateDef } from '../src/main/templates'

// Compares where OUR compositor puts each photo slot with the slots drawn in the old
// system's preview.png (coloured boxes with a white number). Used to verify position,
// size, rotation and layering of every real template.

const SLOT_FILLS: [number, number, number][] = [
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 0],
  [0, 0, 255],
  [255, 128, 0],
  [128, 0, 255]
]

export interface SlotMatch {
  photoNumber: number
  /** share of our slot pixels that are slot-coloured (or the white number) in preview.png */
  precision: number
  /** share of the preview's slot-coloured pixels (near the slot) that our slot covers */
  recall: number
}

const near = (d: Uint8ClampedArray, i: number, c: [number, number, number], tol: number) =>
  Math.abs(d[i]! - c[0]) <= tol && Math.abs(d[i + 1]! - c[1]) <= tol && Math.abs(d[i + 2]! - c[2]) <= tol

export async function matchPreview(t: TemplateDef): Promise<SlotMatch[]> {
  if (!t.previewPath) throw new Error(`${t.id}: no preview.png`)
  const ours = await renderTemplate(
    t,
    t.photos.map((_, i) => ({ fill: `rgb(${SLOT_FILLS[i]!.join(',')})` }))
  )
  const o = ours.getContext('2d').getImageData(0, 0, t.width, t.height).data

  const prevImg = await loadImage(t.previewPath)
  const pc = createCanvas(t.width, t.height)
  pc.getContext('2d').drawImage(prevImg, 0, 0, t.width, t.height)
  const p = pc.getContext('2d').getImageData(0, 0, t.width, t.height).data

  const results: SlotMatch[] = []
  for (let k = 0; k < t.photos.length; k++) {
    const fill = SLOT_FILLS[k]!
    // our slot mask + its bounding box + the preview's dominant colour inside it
    let minX = t.width, minY = t.height, maxX = 0, maxY = 0, count = 0
    const hist = new Map<number, number>()
    const mask = new Uint8Array(t.width * t.height)
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        const i = (y * t.width + x) * 4
        if (!near(o, i, fill, 8)) continue
        mask[y * t.width + x] = 1
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        const q = ((p[i]! >> 4) << 8) | ((p[i + 1]! >> 4) << 4) | (p[i + 2]! >> 4)
        hist.set(q, (hist.get(q) ?? 0) + 1)
      }
    }
    if (count === 0) {
      results.push({ photoNumber: k + 1, precision: 0, recall: 0 })
      continue
    }
    const [q] = [...hist.entries()].sort((a, b) => b[1] - a[1])[0]!
    const slotColor: [number, number, number] = [((q >> 8) & 15) * 16 + 8, ((q >> 4) & 15) * 16 + 8, (q & 15) * 16 + 8]
    const white: [number, number, number] = [255, 255, 255]

    let agree = 0
    let prevSlot = 0
    let prevSlotCovered = 0
    const padX = Math.round((maxX - minX) * 0.15)
    const padY = Math.round((maxY - minY) * 0.15)
    for (let y = Math.max(0, minY - padY); y <= Math.min(t.height - 1, maxY + padY); y++) {
      for (let x = Math.max(0, minX - padX); x <= Math.min(t.width - 1, maxX + padX); x++) {
        const j = y * t.width + x
        const i = j * 4
        const isSlot = near(p, i, slotColor, 24)
        if (mask[j] && (isSlot || near(p, i, white, 40))) agree++
        if (isSlot) {
          prevSlot++
          if (mask[j]) prevSlotCovered++
        }
      }
    }
    results.push({ photoNumber: k + 1, precision: agree / count, recall: prevSlot ? prevSlotCovered / prevSlot : 0 })
  }
  return results
}
