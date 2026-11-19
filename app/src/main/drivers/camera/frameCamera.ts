import { writeFile } from 'node:fs/promises'
import type { CameraDriver, CameraStatus, FrameSource, ProbeSource } from './index'

/**
 * Camera whose frames come from the UI live view:
 *  - 'mock'   → generated test pattern (no hardware, always ready unless `forceNotReady`)
 *  - 'webcam' → the Mac/PC webcam via getUserMedia (for development only)
 */
export class FrameCamera implements CameraDriver {
  readonly id: string

  constructor(
    readonly liveViewSource: 'mock' | 'webcam',
    private grab: FrameSource,
    private probe: ProbeSource,
    private opts: { forceNotReady?: boolean } = {}
  ) {
    this.id = liveViewSource
  }

  async detect(): Promise<CameraStatus> {
    if (this.opts.forceNotReady) return { ready: false, error: 'mock camera forced not ready' }
    // mock pattern size = MOCK_W x MOCK_H in renderer/src/liveview.tsx
    if (this.liveViewSource === 'mock') return { ready: true, model: 'Mock camera', width: 800, height: 1200 }
    return this.probe()
  }

  async capture(destPath: string): Promise<void> {
    const jpeg = await this.grab()
    // JPEG files start with FF D8 — refuse to save anything else as NN.jpg
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('frame is not a JPEG')
    await writeFile(destPath, jpeg)
  }
}
