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
  async status() {
    return this.ready ? { ready: true, model: 'stub' } : { ready: false, error: 'no paper' }
  }
  async print() {}
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
      events: []
    }
    this.records.push(rec)
    return rec
  }
  captureDir(rec: SessionRecord) {
    return `/tmp/${rec.sessionId}`
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
  const m = new BoothMachine({
    config,
    camera,
    printer,
    payment,
    relay,
    store,
    logger,
    captureUrl: (s, f) => `booth://capture/${s}/${f}`
  })
  const states: string[] = []
  m.subscribe((s) => {
    if (states[states.length - 1] !== s.state) states.push(s.state)
  })
  return { m, config, logger, camera, printer, payment, relay, store, states }
}

/** Let pending promises and timers due within `ms` run. */
export async function tick(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}
