import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoothMode } from '../shared/types'

export type SessionStatus = 'active' | 'paid' | 'completed' | 'cancelled' | 'error'

export interface SessionRecord {
  sessionId: string
  uuid: string
  mode: BoothMode
  createdAt: string
  status: SessionStatus
  payment: {
    provider: string
    chargeId: string
    qty: number
    amount: number
    status: 'pending' | 'paid' | 'cancelled' | 'expired'
  } | null
  templateId: string | null
  captures: string[]
  /** PRN-8: kept even when printing fails so staff can reprint */
  print: { file: string; copies: number; status: 'pending' | 'printed' | 'failed' } | null
  events: { at: string; event: string; detail?: string }[]
}

/** sessionId = yyyyMMddHHmmss in local time (PRD archive 2.2). */
export function makeSessionId(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export interface SessionStore {
  create(mode: BoothMode, now: Date): SessionRecord
  sessionDir(rec: SessionRecord): string
  captureDir(rec: SessionRecord): string
  /** CAM-5: move a rejected shot to captures_canceled/ (kept, never deleted); returns the new file name */
  cancelCapture(rec: SessionRecord, fileName: string, retakeNo: number): string
  save(rec: SessionRecord): void
  /** Records a payment confirmation that arrived with no matching active session (PAY-7). */
  recordOrphanPayment(chargeId: string, now: Date): void
}

/**
 * Offline session record: <sessionsDir>/<sessionId>/session.json + captures/.
 * A real transaction DB comes in M2; this file is the audit trail until then.
 */
export class FileSessionStore implements SessionStore {
  constructor(private root: string) {
    mkdirSync(root, { recursive: true })
  }

  create(mode: BoothMode, now: Date): SessionRecord {
    let sessionId = makeSessionId(now)
    // two sessions in the same second must not share a folder
    let n = 1
    const base = sessionId
    while (!this.tryClaim(sessionId)) sessionId = `${base}-${++n}`
    const rec: SessionRecord = {
      sessionId,
      uuid: randomUUID(),
      mode,
      createdAt: now.toISOString(),
      status: 'active',
      payment: null,
      templateId: null,
      captures: [],
      print: null,
      events: []
    }
    mkdirSync(this.captureDir(rec), { recursive: true })
    this.save(rec)
    return rec
  }

  /** Atomically creates the session folder; false if it already exists. */
  private tryClaim(id: string): boolean {
    try {
      mkdirSync(join(this.root, id))
      return true
    } catch {
      return false
    }
  }

  sessionDir(rec: SessionRecord): string {
    return join(this.root, rec.sessionId)
  }

  captureDir(rec: SessionRecord): string {
    return join(this.root, rec.sessionId, 'captures')
  }

  cancelCapture(rec: SessionRecord, fileName: string, retakeNo: number): string {
    const dir = join(this.root, rec.sessionId, 'captures_canceled')
    mkdirSync(dir, { recursive: true })
    const moved = fileName.replace(/\.jpg$/i, `-r${retakeNo}.jpg`)
    renameSync(join(this.captureDir(rec), fileName), join(dir, moved))
    return moved
  }

  save(rec: SessionRecord): void {
    writeFileSync(join(this.root, rec.sessionId, 'session.json'), JSON.stringify(rec, null, 2))
  }

  recordOrphanPayment(chargeId: string, now: Date): void {
    const dir = join(this.root, '_orphan_payments')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${makeSessionId(now)}-${chargeId}.json`), JSON.stringify({ chargeId, at: now.toISOString() }, null, 2))
  }
}
