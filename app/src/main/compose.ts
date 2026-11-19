import { writeFile } from 'node:fs/promises'
import { createCanvas, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import type { TemplateDef } from './templates'

// IMG-3: compose captured photos into the template at full print resolution (600 dpi).
// DEC-011: @napi-rs/canvas (Skia).

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** "cover" fit: scale the source so it fills the box, centred; the overflow is cropped. */
export function coverRect(srcW: number, srcH: number, boxW: number, boxH: number): Box {
  const scale = Math.max(boxW / srcW, boxH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

/** "contain" fit: scale the source to fit inside the box, centred. */
export function containRect(srcW: number, srcH: number, boxW: number, boxH: number): Box {
  const scale = Math.min(boxW / srcW, boxH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

export type PhotoSource = Image | { fill: string }

function drawInBox(
  ctx: SKRSContext2D,
  box: Box,
  rotation: number,
  opacity: number,
  draw: (w: number, h: number) => void
): void {
  ctx.save()
  ctx.globalAlpha = opacity
  // rotate around the element centre *(inferred from the old designer — verified against preview.png in tests)*
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.translate(-box.w / 2, -box.h / 2)
  draw(box.w, box.h)
  ctx.restore()
}

/** Render a template with the given photos (index 0 = PhotoNumber 1). Returns the canvas. */
export async function renderTemplate(t: TemplateDef, photos: PhotoSource[]) {
  if (photos.length < t.photos.length) throw new Error(`template ${t.id} needs ${t.photos.length} photos, got ${photos.length}`)
  const canvas = createCanvas(t.width, t.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = t.background
  ctx.fillRect(0, 0, t.width, t.height)
  ctx.imageSmoothingQuality = 'high'

  for (const el of t.elements) {
    if (el.kind === 'photo') {
      const src = photos[el.photoNumber - 1]!
      drawInBox(ctx, el, el.rotation, el.opacity, (w, h) => {
        ctx.beginPath()
        ctx.rect(0, 0, w, h)
        ctx.clip()
        if ('fill' in src) {
          ctx.fillStyle = src.fill
          ctx.fillRect(0, 0, w, h)
        } else {
          const r = coverRect(src.width, src.height, w, h)
          ctx.drawImage(src, r.x, r.y, r.w, r.h)
        }
      })
    } else {
      const img = await loadImage(el.path)
      drawInBox(ctx, el, el.rotation, el.opacity, (w, h) => {
        // KeepAspect=True → fit inside the box *(inferred)*; False → stretch to the box
        const r = el.keepAspect ? containRect(img.width, img.height, w, h) : { x: 0, y: 0, w, h }
        ctx.drawImage(img, r.x, r.y, r.w, r.h)
      })
    }
  }
  return canvas
}

/** Compose captured JPEG files into the template and write a JPEG to `outPath`. */
export async function composeToFile(t: TemplateDef, photoPaths: string[], outPath: string): Promise<void> {
  const photos = await Promise.all(photoPaths.map((p) => loadImage(p)))
  const canvas = await renderTemplate(t, photos)
  await writeFile(outPath, await canvas.encode('jpeg', 95))
}
