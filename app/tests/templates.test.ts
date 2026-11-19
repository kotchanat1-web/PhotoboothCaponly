import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coverRect } from '../src/main/compose'
import { loadTemplates, parseColor, parseTemplate, sizeFromDimensions } from '../src/main/templates'

const ROOT = join(__dirname, '../../Templates')

describe('template.xml import (TPL-3) — real templates from the old booth', () => {
  const { templates, errors } = loadTemplates(ROOT)

  it('imports all 21 templates without errors', () => {
    expect(errors).toEqual([])
    expect(templates).toHaveLength(21)
  })

  it('ids are unique even though the XML Ids are duplicated (TPL-6 / DEC-012)', () => {
    const ids = templates.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const legacy = templates.map((t) => t.legacyId)
    expect(new Set(legacy).size).toBeLessThan(legacy.length) // the old data really has duplicates
  })

  it('shot counts and sizes match the XML', () => {
    const byId = Object.fromEntries(templates.map((t) => [t.id, t]))
    expect(byId['4x6-401']!.photos).toHaveLength(4)
    expect(byId['4x6-401']!.size).toBe('4x6')
    expect(byId['4x6-601']!.photos).toHaveLength(6)
    expect(byId['4x6-101']!.photos).toHaveLength(1)
    expect(byId['2x6-02']!.photos).toHaveLength(3)
    expect(byId['2x6-02']!.size).toBe('2x6')
    expect(byId['2x6-02']!.photos.map((p) => p.rotation)).toEqual([8, -5, 17])
  })

  it('seasonal (dot) folders are hidden (M1-2 Q1), others visible', () => {
    const hidden = templates.filter((t) => !t.visible).map((t) => t.id)
    expect(hidden.sort()).toEqual(['.2x6-xmas', '.4x6-xmas'])
  })

  it('draw order follows ZIndex (4x6-401: overlay ZIndex 0 is drawn first, under the photos)', () => {
    const t = templates.find((x) => x.id === '4x6-401')!
    expect(t.elements[0]!.kind).toBe('image')
    expect(t.elements.slice(1).every((e) => e.kind === 'photo')).toBe(true)
  })
})

describe('template parser edge cases', () => {
  const wrap = (els: string, head = 'Width="2400" Height="3600"') => `﻿<?xml version="1.0"?><Template ${head} Id="x"><Elements>${els}</Elements></Template>`

  it('rejects a template with no photo slots', () => {
    expect(() => parseTemplate('/tmp', 't', wrap(''))).toThrow(/no photo slots/)
  })
  it('rejects gaps in PhotoNumber', () => {
    const els = '<Photo Width="10" Height="10" Top="0" Left="0" PhotoNumber="1" /><Photo Width="10" Height="10" Top="0" Left="0" PhotoNumber="3" />'
    expect(() => parseTemplate('/tmp', 't', wrap(els))).toThrow(/without gaps/)
  })
  it('rejects an overlay image path outside the folder', () => {
    const els = '<Photo Width="10" Height="10" Top="0" Left="0" PhotoNumber="1" /><Image Width="10" Height="10" Top="0" Left="0" ImagePath="../x.png" />'
    expect(() => parseTemplate('/tmp', 't', wrap(els))).toThrow(/ImagePath/)
  })
  it('skips IsVisible="False" elements', () => {
    const els = '<Photo Width="10" Height="10" Top="0" Left="0" PhotoNumber="1" /><Photo IsVisible="False" Width="10" Height="10" Top="0" Left="0" PhotoNumber="2" />'
    expect(parseTemplate('/tmp', 't', wrap(els)).photos).toHaveLength(1)
  })
  it('rejects unsupported sizes', () => {
    expect(() => sizeFromDimensions(1000, 1000)).toThrow()
    expect(sizeFromDimensions(1200, 3600)).toBe('2x6')
  })
  it('parses WPF #AARRGGBB colours', () => {
    expect(parseColor('#FFFFFFFF')).toBe('rgba(255,255,255,1)')
    expect(parseColor('#80FF0000')).toBe('rgba(255,0,0,0.502)')
    expect(parseColor('#00FF00')).toBe('rgba(0,255,0,1)')
  })
})

describe('cover crop (IMG-3) — known answers', () => {
  it('800x1200 photo into a 1030x1530 slot', () => {
    // scale = max(1030/800, 1530/1200) = max(1.2875, 1.275) = 1.2875 → 1030 x 1545, 7.5 px cropped top and bottom
    const r = coverRect(800, 1200, 1030, 1530)
    expect(r.w).toBeCloseTo(1030)
    expect(r.h).toBeCloseTo(1545)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(-7.5)
  })
  it('landscape 1920x1080 webcam frame into a square 950x950 slot', () => {
    // scale = max(950/1920, 950/1080) = 0.8796 → 1688.9 x 950, cropped left/right
    const r = coverRect(1920, 1080, 950, 950)
    expect(r.h).toBeCloseTo(950)
    expect(r.w).toBeCloseTo(1688.89, 1)
    expect(r.x).toBeCloseTo(-369.44, 1)
  })
})
