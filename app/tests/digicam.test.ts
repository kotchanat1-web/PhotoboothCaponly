import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateConfig } from '../src/main/config'
import { DigicamCamera, looksLikeShutter, type DigicamExposure } from '../src/main/drivers/camera/digicam'
import { defaultConfig } from './helpers'

const tmp: string[] = []
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true })
})

const NO_EXPOSURE: DigicamExposure = { shutterspeed: '', aperture: '', iso: '', whitebalance: '' }

/**
 * Fake digiCamControl web server. `reply(cmd, p1, p2)` returns the text body
 * (the real server answers plain text: value / list lines / "OK" / error message).
 */
function fakeServer(reply: (cmd: string, p1: string, p2: string) => string | Error) {
  const calls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.searchParams.has('CMD')) {
      calls.push(`CMD ${url.searchParams.get('CMD')}`)
      return new Response('OK')
    }
    const cmd = url.searchParams.get('slc') ?? ''
    const p1 = url.searchParams.get('param1') ?? ''
    const p2 = url.searchParams.get('param2') ?? ''
    calls.push(`${cmd} ${p1} ${p2}`.trim())
    const r = reply(cmd, p1, p2)
    if (r instanceof Error) throw r
    return new Response(r)
  }) as typeof fetch
  return { calls, fetchImpl }
}

function camera(fetchImpl: typeof fetch, exposure: Partial<DigicamExposure> = {}, captureTimeoutMs = 2000) {
  return new DigicamCamera({
    baseUrl: 'http://127.0.0.1:5513/',
    exposure: { ...NO_EXPOSURE, ...exposure },
    captureTimeoutMs,
    fetch: fetchImpl,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5)))
  })
}

/** values a 70D-like camera would offer (format verified from digiCamControl source: "1/125", "5.6") */
const VALUES: Record<string, string[]> = {
  shutterspeed: ['1/60', '1/125', '1/250'],
  aperture: ['4.0', '5.6', '8.0'],
  iso: ['100', '200', '400'],
  whitebalance: ['Auto', 'Daylight']
}

function cameraServer() {
  const current: Record<string, string> = { shutterspeed: '1/60', aperture: '4.0', iso: '100', whitebalance: 'Auto' }
  return fakeServer((cmd, p1, p2) => {
    if (cmd === 'get') return current[p1] ?? 'OK'
    if (cmd === 'list') return VALUES[p1]!.join('\n') + '\n'
    if (cmd === 'set') {
      if (!VALUES[p1]!.includes(p2)) return `Wrong value for ${p1}: ${p2}`
      current[p1] = p2
      return 'OK'
    }
    return 'OK'
  })
}

describe('digiCamControl camera (DEC-016, CAM-1)', () => {
  it('web server not running → not ready, tells staff how to enable it', async () => {
    const { fetchImpl } = fakeServer(() => new Error('fetch failed'))
    const st = await camera(fetchImpl).detect()
    expect(st.ready).toBe(false)
    expect(st.error).toMatch(/not reachable at http:\/\/127\.0\.0\.1:5513 .*Webserver/)
  })

  it('no camera connected ("OK" instead of a shutter value) → not ready', async () => {
    const { fetchImpl } = fakeServer(() => 'OK')
    const st = await camera(fetchImpl).detect()
    expect(st).toMatchObject({ ready: false })
    expect(st.error).toMatch(/no camera/)
  })

  it('sets shutter / F / ISO from config (empty = keep), reads them back, starts live view', async () => {
    const { calls, fetchImpl } = cameraServer()
    const st = await camera(fetchImpl, { shutterspeed: '1/125', aperture: '5.6', iso: '200' }).detect()
    expect(st).toMatchObject({
      ready: true,
      model: 'digiCamControl',
      exposure: { shutterspeed: '1/125', aperture: '5.6', iso: '200', whitebalance: 'Auto' }
    })
    expect(calls.filter((c) => c.startsWith('set'))).toEqual(['set shutterspeed 1/125', 'set aperture 5.6', 'set iso 200'])
    expect(calls).toContain('CMD LiveViewWnd_Show')
  })

  it('value the camera does not offer → not ready, error lists the allowed values', async () => {
    const { fetchImpl } = cameraServer()
    const st = await camera(fetchImpl, { aperture: 'f/5.6' }).detect()
    expect(st.ready).toBe(false)
    expect(st.error).toBe('set aperture "f/5.6" failed: Wrong value for aperture: f/5.6 — allowed: 4.0, 5.6, 8.0')
  })

  it('capture: sends the full target path, waits for the JPEG, moves it to NN.jpg', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcc-'))
    tmp.push(dir)
    const { calls, fetchImpl } = fakeServer((cmd, p1) => {
      // digiCamControl saves <path>.jpg (extension added by the camera's format)
      if (cmd === 'capture') setTimeout(() => writeFileSync(`${p1}.jpg`, 'JPEGDATA'), 20)
      return 'OK'
    })
    const dest = join(dir, '01.jpg')
    await camera(fetchImpl).capture(dest)
    expect(readFileSync(dest, 'utf8')).toBe('JPEGDATA')
    expect(calls[0]).toMatch(/^capture .*01-dcc-\d+$/)
    expect(calls[0]!.slice('capture '.length).startsWith(join(dir, '01-dcc-'))).toBe(true)
  })

  it('capture: camera saves RAW only → clear error (set quality to JPEG)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcc-'))
    tmp.push(dir)
    const { fetchImpl } = fakeServer((cmd, p1) => {
      if (cmd === 'capture') writeFileSync(`${p1}.cr2`, 'RAW')
      return 'OK'
    })
    await expect(camera(fetchImpl).capture(join(dir, '02.jpg'))).rejects.toThrow(/\.cr2 .*JPEG/)
    expect(existsSync(join(dir, '02.jpg'))).toBe(false)
  })

  it('capture: error text from digiCamControl or no file in time → fails (machine retries / Error screen)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcc-'))
    tmp.push(dir)
    const busy = fakeServer(() => 'Camera busy')
    await expect(camera(busy.fetchImpl).capture(join(dir, '01.jpg'))).rejects.toThrow('digiCamControl capture failed: Camera busy')
    const silent = fakeServer(() => 'OK')
    await expect(camera(silent.fetchImpl, {}, 100).capture(join(dir, '01.jpg'))).rejects.toThrow(/did not appear within 100 ms/)
  })

  it('shutter value recogniser — known answers', () => {
    for (const v of ['1/125', '1/4000', '30s', '0.5', '2"', 'Bulb']) expect(looksLikeShutter(v), v).toBe(true)
    for (const v of ['OK', '', 'Object reference not set to an instance of an object.']) expect(looksLikeShutter(v), v).toBe(false)
  })

  it('config: driver digicam is valid; unknown driver / bad baseUrl rejected', () => {
    expect(validateConfig(defaultConfig({ camera: { driver: 'digicam' } }))).toEqual([])
    expect(validateConfig(defaultConfig({ camera: { driver: 'canon' } }))).toContain('camera.driver must be "mock", "webcam" or "digicam"')
    expect(validateConfig(defaultConfig({ camera: { digicam: { baseUrl: '127.0.0.1:5513' } } }))).toContain(
      'camera.digicam.baseUrl must start with http:// or https://'
    )
  })
})
