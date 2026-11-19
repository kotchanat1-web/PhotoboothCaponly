import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// TPL-3: import the old booth's template.xml format (PRD archive 2.4).
// TPL-6 / DEC-012: the template id is the folder name (unique by construction);
// the XML "Id" (duplicated in the old data) is kept only as `legacyId`.

export interface PhotoElement {
  kind: 'photo'
  photoNumber: number
  x: number
  y: number
  w: number
  h: number
  /** degrees, clockwise, around the element centre */
  rotation: number
  opacity: number
  z: number
}

export interface ImageElement {
  kind: 'image'
  path: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
  opacity: number
  keepAspect: boolean
  z: number
}

export type TemplateElement = PhotoElement | ImageElement

export interface TemplateDef {
  id: string
  legacyId: string
  name: string
  dir: string
  width: number
  height: number
  size: '4x6' | '2x6'
  /** CSS colour */
  background: string
  print2PerPage: boolean
  printToSecondary: boolean
  /** folder starts with "." → seasonal (PRD archive 2.4); hidden until TPL-4 (M1-2 Q1) */
  seasonal: boolean
  visible: boolean
  previewPath: string | null
  /** photo slots ordered by PhotoNumber */
  photos: PhotoElement[]
  /** all visible elements in draw order (ZIndex, then document order) */
  elements: TemplateElement[]
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function parseAttributes(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of src.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g)) {
    out[m[1]!] = m[2]!.replace(/&(amp|lt|gt|quot|apos);/g, (_s, e: string) => XML_ENTITIES[e]!)
  }
  return out
}

/** "#AARRGGBB" (WPF) or "#RRGGBB" → CSS rgba() */
export function parseColor(v: string | undefined): string {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v ?? '')
  if (!m) return '#ffffff'
  const hex = m[1]!
  const [a, r, g, b] =
    hex.length === 8
      ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16)]
      : [255, parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
  return `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`
}

function num(attrs: Record<string, string>, key: string, where: string, fallback?: number): number {
  const raw = attrs[key]
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback
    throw new Error(`${where}: missing ${key}`)
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`${where}: ${key}="${raw}" is not a number`)
  return n
}

const bool = (v: string | undefined) => (v ?? '').toLowerCase() === 'true'

export function sizeFromDimensions(width: number, height: number): '4x6' | '2x6' {
  const r = width / height
  if (Math.abs(r - 2 / 3) < 0.01) return '4x6'
  if (Math.abs(r - 1 / 3) < 0.01) return '2x6'
  throw new Error(`unsupported template size ${width}x${height} (expected 2:3 for 4x6 or 1:3 for 2x6)`)
}

/** Parse one template folder. Throws with a clear message if the template is unusable. */
export function parseTemplate(dir: string, id: string, xml: string): TemplateDef {
  const src = xml.replace(/^﻿/, '')
  const head = /<Template\b([^>]*)>/.exec(src)
  if (!head) throw new Error(`${id}: no <Template> element`)
  const t = parseAttributes(head[1]!)
  const width = num(t, 'Width', id)
  const height = num(t, 'Height', id)

  const elements: TemplateElement[] = []
  let order = 0
  for (const m of src.matchAll(/<(Photo|Image)\b([^>]*?)\/?>/g)) {
    const kind = m[1]!
    const a = parseAttributes(m[2]!)
    const where = `${id}/${a['Name'] ?? kind}`
    order++
    if (a['IsVisible'] !== undefined && !bool(a['IsVisible'])) continue
    const base = {
      x: num(a, 'Left', where),
      y: num(a, 'Top', where),
      w: num(a, 'Width', where),
      h: num(a, 'Height', where),
      rotation: num(a, 'Rotation', where, 0),
      opacity: Math.min(1, Math.max(0, num(a, 'Opacity', where, 100) / 100)),
      // ZIndex ties keep document order
      z: num(a, 'ZIndex', where, 0) + order / 10_000
    }
    if (base.w <= 0 || base.h <= 0) throw new Error(`${where}: width/height must be > 0`)
    if (kind === 'Photo') {
      elements.push({ kind: 'photo', photoNumber: num(a, 'PhotoNumber', where), ...base })
    } else {
      const file = a['ImagePath'] ?? ''
      if (!file) continue
      if (file.includes('/') || file.includes('\\') || file.includes('..')) throw new Error(`${where}: ImagePath must be a file in the template folder`)
      const path = join(dir, file)
      if (!existsSync(path)) throw new Error(`${where}: image file not found: ${file}`)
      elements.push({ kind: 'image', path, keepAspect: bool(a['KeepAspect']), ...base })
    }
  }
  elements.sort((p, q) => p.z - q.z)

  const photos = elements.filter((e): e is PhotoElement => e.kind === 'photo').sort((p, q) => p.photoNumber - q.photoNumber)
  if (photos.length === 0) throw new Error(`${id}: template has no photo slots`)
  photos.forEach((p, i) => {
    if (p.photoNumber !== i + 1) throw new Error(`${id}: PhotoNumber must be 1..${photos.length} without gaps (found ${photos.map((x) => x.photoNumber).join(',')})`)
  })

  const preview = join(dir, 'preview.png')
  const seasonal = id.startsWith('.')
  return {
    id,
    legacyId: t['Id'] ?? '',
    name: id.replace(/^\./, ''),
    dir,
    width,
    height,
    size: sizeFromDimensions(width, height),
    background: parseColor(t['BackgroundColor']),
    print2PerPage: bool(t['print_2_per_page']),
    printToSecondary: bool(t['PrintToSecondaryPrinter']),
    seasonal,
    visible: !seasonal,
    previewPath: existsSync(preview) ? preview : null,
    photos,
    elements
  }
}

export interface LoadResult {
  templates: TemplateDef[]
  errors: { id: string; error: string }[]
}

/** Load every sub-folder that has a template.xml. Bad templates are reported, not fatal. */
export function loadTemplates(root: string): LoadResult {
  const templates: TemplateDef[] = []
  const errors: LoadResult['errors'] = []
  if (!existsSync(root)) return { templates, errors: [{ id: root, error: 'templates folder not found' }] }
  for (const id of readdirSync(root).sort()) {
    const dir = join(root, id)
    if (!statSync(dir).isDirectory()) continue
    const xmlPath = join(dir, 'template.xml')
    if (!existsSync(xmlPath)) continue
    try {
      templates.push(parseTemplate(dir, id, readFileSync(xmlPath, 'utf8')))
    } catch (e) {
      errors.push({ id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { templates, errors }
}
