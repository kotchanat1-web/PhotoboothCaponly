import { copyFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

// Printer abstraction (PRN-9). DNP DS-RX1 driver comes in M1-4.

export interface PrinterStatus {
  ready: boolean
  model?: string
  error?: string
}

export interface PrinterDriver {
  readonly id: string
  status(): Promise<PrinterStatus>
  print(filePath: string, copies: number): Promise<void>
}

/** Mock printer: "prints" by copying the file into `outDir` once per copy. */
export class MockPrinter implements PrinterDriver {
  readonly id = 'mock'
  constructor(private outDir: string, private opts: { forceNotReady?: boolean } = {}) {}

  async status(): Promise<PrinterStatus> {
    if (this.opts.forceNotReady) return { ready: false, error: 'mock printer forced not ready' }
    return { ready: true, model: 'Mock printer' }
  }

  async print(filePath: string, copies: number): Promise<void> {
    await mkdir(this.outDir, { recursive: true })
    for (let i = 1; i <= copies; i++) {
      await copyFile(filePath, join(this.outDir, `${Date.now()}-${i}-${basename(filePath)}`))
    }
  }
}
