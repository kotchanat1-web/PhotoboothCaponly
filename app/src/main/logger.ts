import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void
}

/** Structured JSON-lines log, one file per day (PRD NFR Logging). Do not pass personal data in `data`. */
export class FileLogger implements Logger {
  constructor(private dir: string, private echo = true) {
    mkdirSync(dir, { recursive: true })
  }

  log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
    const now = new Date()
    const line = JSON.stringify({ ts: now.toISOString(), level, event, ...data })
    const day = now.toISOString().slice(0, 10)
    try {
      appendFileSync(join(this.dir, `booth-${day}.log`), line + '\n')
    } catch {
      // logging must never crash the booth
    }
    if (this.echo) console.log(line)
  }

  /** Delete log files older than `days`. */
  prune(days: number): void {
    const cutoff = Date.now() - days * 86_400_000
    for (const f of readdirSync(this.dir)) {
      if (!/^booth-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue
      const p = join(this.dir, f)
      if (statSync(p).mtimeMs < cutoff) unlinkSync(p)
    }
  }
}

export class MemoryLogger implements Logger {
  entries: { level: LogLevel; event: string; data: Record<string, unknown> }[] = []
  log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
    this.entries.push({ level, event, data })
  }
}
