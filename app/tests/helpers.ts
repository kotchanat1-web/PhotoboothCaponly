import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import { deepMerge, type BoothConfig } from '../src/main/config'
import type { CameraDriver, CameraStatus } from '../src/main/drivers/camera'
import { MockPaymentProvider } from '../src/main/drivers/payment'
import type { PrinterDriver } from '../src/main/drivers/printer'
import { MockRelay } from '../src/main/drivers/relay'
import { MemoryLogger } from '../src/main/logger'
import { BoothMachine } from '../src/main/machine'
import type { SessionRecord, SessionStore } from '../src/main/session'
import type { PhotoElement, TemplateDef } from '../src/main/templates'

/** Synthetic templates for machine tests (real template.xml import is covered in templates.test.ts). */
export function fakeTemplate(id: string, shots: number, opts: Partial<TemplateDef> = {}): TemplateDef {
  const photos: PhotoElement[] = Array.from({ length: shots }, (_, i) => ({
    kind: 'photo', photoNumber: i + 1, x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, z: i
  }))
  return {
    id, legacyId: '', name: id, dir: '/tmp', width: 2400, height: 3600, size: '4x6', background: '#fff',
    print2PerPage: false, printToSecondary: false, seasonal: false, visible: true, previewPath: null,
    photos, elements: photos, ...opts
  }
}

export const TEMPLATES = [
  fakeTemplate('t4', 4),
  fakeTemplate('t3', 3, { size: '2x6', width: 1200 }),
  fakeTemplate('t1', 1),
  fakeTemplate('.hidden', 2, { seasonal: true, visible: false })
]

export function defaultConfig(override: unknown = {}): BoothConfig {
  const base = JSON.parse(readFileSync(join(__dirname, '../config/default.json'), 'utf8')) as BoothConfig
  return deepMerge(base, override)
}

export class StubCamera implements CameraDriver {
  readonly id = 'stub'
  readonly liveViewSource = 'mock' as const
  detectResults: CameraStatus[] = []
  captureImpl: (p: string) => Promise<void> = async () => {}
  captured: string[] = []
  async detect(): Promise<CameraStatus> {
    return this.detectResults.shift() ?? { ready: true, model: 'stub' }
  }
  async capture(p: string): Promise<void> {
    await this.captureImpl(p)
    this.captured.push(p)
  }
}

export class StubPrinter implements PrinterDriver {
  readonly id = 'stub'
  ready = true
  jobs: { file: string; copies: number }[] = []
  printImpl: () => Promise<void> = async () => {}
  async status() {
    return this.ready ? { ready: true, model: 'stub' } : { ready: false, error: 'no paper' }
  }
  async print(file: string, copies: number) {
    await this.printImpl()
    this.jobs.push({ file, copies })
  }
}

export class MemoryStore implements SessionStore {
  records: SessionRecord[] = []
  orphans: string[] = []
  private n = 0
  create(mode: SessionRecord['mode'], now: Date): SessionRecord {
    const rec: SessionRecord = {
      sessionId: `S${++this.n}`,
      uuid: `u${this.n}`,
      mode,
      createdAt: now.toISOString(),
      status: 'active',
      payment: null,
      templateId: null,
      captures: [],
      print: null,
      events: []
    }
    this.records.push(rec)
    return rec
  }
  sessionDir(rec: SessionRecord) {
    return `/tmp/${rec.sessionId}`
  }
  captureDir(rec: SessionRecord) {
    return `/tmp/${rec.sessionId}/captures`
  }
  canceled: string[] = []
  cancelCapture(_rec: SessionRecord, fileName: string, retakeNo: number) {
    const moved = fileName.replace(/\.jpg$/, `-r${retakeNo}.jpg`)
    this.canceled.push(moved)
    return moved
  }
  save() {}
  recordOrphanPayment(chargeId: string) {
    this.orphans.push(chargeId)
  }
}

export function setup(override: unknown = {}) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-19T10:00:00'))
  const config = defaultConfig(override)
  const logger = new MemoryLogger()
  const camera = new StubCamera()
  const printer = new StubPrinter()
  const payment = new MockPaymentProvider({ autoPaySec: 0 })
  const relay = new MockRelay(logger)
  const store = new MemoryStore()
  const composer = {
    calls: [] as { id: string; photos: string[]; out: string }[],
    impl: async (_t: TemplateDef, _p: string[], _o: string) => {}
  }
  const m = new BoothMachine({
    config,
    camera,
    printer,
    payment,
    relay,
    store,
    logger,
    templates: TEMPLATES,
    compose: async (t, photos, out) => {
      composer.calls.push({ id: t.id, photos, out })
      await composer.impl(t, photos, out)
    },
    urls: {
      capture: (s, f) => `booth://capture/${s}/${f}`,
      print: (s, f) => `booth://print/${s}/${f}`,
      preview: (id) => `booth://template/${id}/preview.png`
    }
  })
  const states: string[] = []
  m.subscribe((s) => {
    if (states[states.length - 1] !== s.state) states.push(s.state)
  })
  return { m, config, logger, camera, printer, payment, relay, store, states, composer }
}

/** Let pending promises and timers due within `ms` run. */
export async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}
