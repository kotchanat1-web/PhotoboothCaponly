import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickVideoDevice, rotatedSize, upscaleFactor } from '../src/shared/camera'
import { validateConfig } from '../src/main/config'
import { defaultConfig, setup, tick } from './helpers'

afterEach(() => {
  vi.useRealTimers()
})

const devices = [
  { deviceId: 'a', label: 'FaceTime HD Camera', kind: 'videoinput' },
  { deviceId: 'm', label: 'MacBook Microphone', kind: 'audioinput' },
  { deviceId: 'b', label: 'EOS Webcam Utility', kind: 'videoinput' }
]

describe('pickVideoDevice (W1/W2)', () => {
  it('empty label → first video input', () => {
    expect(pickVideoDevice(devices, '')?.deviceId).toBe('a')
  })
  it('matches part of the name, case-insensitive', () => {
    expect(pickVideoDevice(devices, 'eos webcam')?.deviceId).toBe('b')
  })
  it('no match → null (booth must not silently use another camera)', () => {
    expect(pickVideoDevice(devices, 'Logitech')).toBeNull()
  })
  it('never picks an audio device', () => {
    expect(pickVideoDevice(devices, 'Microphone')).toBeNull()
  })
})

describe('rotation + resolution maths — known answers', () => {
  it('rotating 1920x1080 by 90/270 gives 1080x1920', () => {
    expect(rotatedSize(1920, 1080, 90)).toEqual({ w: 1080, h: 1920 })
    expect(rotatedSize(1920, 1080, 270)).toEqual({ w: 1080, h: 1920 })
    expect(rotatedSize(1920, 1080, 180)).toEqual({ w: 1920, h: 1080 })
  })
  it('1080p landscape into a 1030x1530 slot needs x1.42 upscale', () => {
    expect(upscaleFactor(1920, 1080, 1030, 1530)).toBeCloseTo(1530 / 1080) // 1.4167
  })
  it('1080p mounted portrait (1080x1920) fills a 1030x1530 slot without upscaling', () => {
    expect(upscaleFactor(1080, 1920, 1030, 1530)).toBeLessThanOrEqual(1) // 0.954
  })
  it('4K landscape (3840x2160) fills the largest slot 1447x1950 (4x6-101)', () => {
    expect(upscaleFactor(3840, 2160, 1447, 1950)).toBeLessThanOrEqual(1) // 0.903
  })
})

describe('config validation', () => {
  it('rejects a rotation that is not 0/90/180/270', () => {
    expect(validateConfig(defaultConfig({ camera: { rotation: 45 } })).join()).toMatch(/rotation/)
  })
  it('accepts 270 (old booth mounting)', () => {
    expect(validateConfig(defaultConfig({ camera: { rotation: 270 } }))).toEqual([])
  })
})

describe('machine: camera resolution', () => {
  async function selectTemplate(ctx: ReturnType<typeof setup>, id: string) {
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id })
  }

  it('logs camera.ready with model, size and device list', async () => {
    const ctx = setup({ mode: 'event' })
    ctx.camera.detectResults = [{ ready: true, model: 'EOS Webcam Utility', width: 1080, height: 1920, devices: ['EOS Webcam Utility'] }]
    await selectTemplate(ctx, 't1')
    const e = ctx.logger.entries.find((x) => x.event === 'camera.ready')!
    expect(e.data).toMatchObject({ model: 'EOS Webcam Utility', width: 1080, height: 1920 })
  })

  it('warns (does not block) when the frame is too small for the template slots', async () => {
    const ctx = setup({ mode: 'event' })
    // fake templates have 100x100 slots → use a tiny 50x80 camera so it must upscale x2
    ctx.camera.detectResults = [{ ready: true, model: 'tiny', width: 50, height: 80 }]
    await selectTemplate(ctx, 't1')
    expect(ctx.m.snapshot.state).toBe('Instruction')
    const w = ctx.logger.entries.find((x) => x.event === 'capture.low_resolution')!
    expect(w.data).toMatchObject({ template: 't1', upscale: 2 })
    expect(ctx.store.records[0]!.events.map((e) => e.event)).toContain('capture.low_resolution')
  })

  it('no warning when the frame is big enough', async () => {
    const ctx = setup({ mode: 'event' })
    ctx.camera.detectResults = [{ ready: true, model: 'big', width: 1080, height: 1920 }]
    await selectTemplate(ctx, 't1')
    expect(ctx.logger.entries.some((x) => x.event === 'capture.low_resolution')).toBe(false)
  })

  it('snapshot carries rotation + webcam settings for the UI', () => {
    const ctx = setup({ camera: { rotation: 270, webcam: { deviceLabel: 'EOS' } } })
    expect(ctx.m.snapshot.liveView).toMatchObject({ rotation: 270, webcam: { deviceLabel: 'EOS', idealWidth: 3840, idealHeight: 2160 } })
  })
})

