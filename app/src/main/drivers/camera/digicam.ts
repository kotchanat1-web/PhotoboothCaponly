import { readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { CameraDriver, CameraStatus } from './index'

/**
 * Camera exposure settings sent to digiCamControl (CAM-1). Empty string = leave the camera as it is.
 * Value strings must match what the camera offers — list them with
 *   http://127.0.0.1:5513/?slc=list&param1=shutterspeed&param2=   (also aperture / iso / whitebalance)
 */
export interface DigicamExposure {
  shutterspeed: string
  aperture: string
  iso: string
  whitebalance: string
}

export interface DigicamOptions {
  /** digiCamControl web server, e.g. http://127.0.0.1:5513 (Settings → Webserver) */
  baseUrl: string
  exposure: DigicamExposure
  /** how long to wait for the photo file to appear after the capture command */
  captureTimeoutMs: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export const EXPOSURE_KEYS = ['shutterspeed', 'aperture', 'iso', 'whitebalance'] as const

/** File poll interval while waiting for digiCamControl to save the photo. */
const POLL_MS = 200
/** Per-request timeout for the web server (capture itself waits up to 30 s inside digiCamControl). */
const REQUEST_MS = 5000
const CAPTURE_REQUEST_MS = 40_000

/**
 * DSLR through digiCamControl (free, Windows) — DEC-016.
 * Talks to its built-in web server ("slc" single-command API, verified from digiCamControl source
 * WebServerModule.cs / CommandLineProcessor.cs, master branch):
 *  - GET /?slc=<cmd>&param1=<a>&param2=<b>  → plain text: the value, one list item per line, "OK", or an error message
 *  - capture with a full path sets the session folder + file name (extension is added by digiCamControl)
 *  - GET /liveview.jpg → current live view frame (after ?CMD=LiveViewWnd_Show)
 */
export class DigicamCamera implements CameraDriver {
  readonly id = 'digicam'
  readonly liveViewSource = 'digicam' as const
  private readonly fetch: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private opts: DigicamOptions) {
    this.fetch = opts.fetch ?? fetch
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  get liveViewUrl(): string {
    return `${this.base()}/liveview.jpg`
  }

  /** Send one slc command; returns the trimmed text body. */
  async slc(cmd: string, param1 = '', param2 = '', timeoutMs = REQUEST_MS): Promise<string> {
    const q = new URLSearchParams({ slc: cmd, param1, param2 })
    const res = await this.fetch(`${this.base()}/?${q.toString()}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`digiCamControl HTTP ${res.status}`)
    return (await res.text()).trim()
  }

  /** Allowed values for an exposure setting (one per line in the web response). */
  async list(name: (typeof EXPOSURE_KEYS)[number]): Promise<string[]> {
    const body = await this.slc('list', name)
    return body.split(/\r?\n/).map((v) => v.trim()).filter((v) => v && v !== 'OK')
  }

  async detect(): Promise<CameraStatus> {
    let current: string
    try {
      current = await this.slc('get', 'shutterspeed')
    } catch (e) {
      return {
        ready: false,
        error: `digiCamControl web server not reachable at ${this.base()} — open digiCamControl and enable Settings → Webserver (+ "Allow interaction via web server") (${errText(e)})`
      }
    }
    // with a camera the reply is a shutter value ("1/125", "30s", "Bulb"); without one it is "OK" (null) or an error text
    if (!looksLikeShutter(current)) return { ready: false, error: `no camera in digiCamControl (reply: "${current.slice(0, 80)}")` }

    for (const key of EXPOSURE_KEYS) {
      const value = this.opts.exposure[key]?.trim()
      if (!value) continue
      const reply = await this.slc('set', key, value).catch((e: unknown) => errText(e))
      if (reply !== 'OK') {
        const allowed = await this.list(key).catch(() => [] as string[])
        return {
          ready: false,
          error: `set ${key} "${value}" failed: ${reply}${allowed.length ? ` — allowed: ${allowed.join(', ')}` : ''}`
        }
      }
    }

    const exposure: Record<string, string> = {}
    for (const key of EXPOSURE_KEYS) exposure[key] = await this.slc('get', key).catch(() => '?')

    // live view must be started explicitly; failure here does not block shooting
    await this.fetch(`${this.base()}/?CMD=LiveViewWnd_Show`, { signal: AbortSignal.timeout(REQUEST_MS) }).catch(() => undefined)
    return { ready: true, model: 'digiCamControl', exposure }
  }

  /** CAM-4: shoot on the DSLR, wait for digiCamControl to save the JPEG, move it to destPath. */
  async capture(destPath: string): Promise<void> {
    const dir = dirname(destPath)
    const stem = `${basename(destPath, extname(destPath))}-dcc-${Date.now()}`
    const reply = await this.slc('capture', join(dir, stem), '', CAPTURE_REQUEST_MS)
    if (reply !== 'OK') throw new Error(`digiCamControl capture failed: ${reply}`)

    const until = Date.now() + this.opts.captureTimeoutMs
    let lastSize = -1
    while (Date.now() < until) {
      const files = (await readdir(dir)).filter((f) => f.startsWith(stem))
      const jpg = files.find((f) => /\.jpe?g$/i.test(f))
      if (jpg) {
        // the file is complete when its size stops changing between two polls
        const size = (await stat(join(dir, jpg))).size
        if (size > 0 && size === lastSize) {
          await rename(join(dir, jpg), destPath)
          return
        }
        lastSize = size
      } else if (files.length > 0) {
        throw new Error(`camera saved ${files.join(', ')} — set image quality to JPEG on the camera`)
      }
      await this.sleep(POLL_MS)
    }
    throw new Error(`photo file did not appear within ${this.opts.captureTimeoutMs} ms`)
  }

  private base(): string {
    return this.opts.baseUrl.replace(/\/+$/, '')
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** "1/125", "1/4000", "0.5", "30s", "30\"", "Bulb" */
export function looksLikeShutter(v: string): boolean {
  return /^(bulb|\d+(\.\d+)?(\/\d+)?\s*(s|")?)$/i.test(v.trim())
}
