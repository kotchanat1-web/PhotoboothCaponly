// CAM-9: camera abstraction. Real Canon/Nikon/Fuji drivers come in M1-3 and implement this same interface.

export interface CameraStatus {
  ready: boolean
  model?: string
  error?: string
  /** frame size after mounting rotation (webcam drivers) */
  width?: number
  height?: number
  /** labels of all video inputs seen (webcam drivers) — logged to help pick camera.webcam.deviceLabel */
  devices?: string[]
}

export interface CameraDriver {
  readonly id: string
  /** Where the UI gets live view from. Real DSLR drivers will add a 'stream' source in M1-3. */
  readonly liveViewSource: 'mock' | 'webcam'
  detect(): Promise<CameraStatus>
  /** CAM-4: take the photo and write it as JPEG to `destPath`. */
  capture(destPath: string): Promise<void>
}

/** Supplies one JPEG frame (from the live view shown in the UI). */
export type FrameSource = () => Promise<Buffer>
export type ProbeSource = () => Promise<CameraStatus>
