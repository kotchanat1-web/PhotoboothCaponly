import { afterEach, describe, expect, it, vi } from 'vitest'
import { basename, join } from 'node:path'
import { setup, tick } from './helpers'

afterEach(() => {
  vi.useRealTimers()
})

async function toWaitPayment(ctx: ReturnType<typeof setup>, qty = 1) {
  await ctx.m.start()
  ctx.m.dispatch({ type: 'TOUCH' })
  await tick()
  ctx.m.dispatch({ type: 'CHOOSE_PROMPTPAY' })
  ctx.m.dispatch({ type: 'SELECT_QTY', qty })
  await tick()
}

async function shootAll(ctx: ReturnType<typeof setup>, shots: number) {
  const { countdownSec } = ctx.config.capture
  const review = ctx.config.timeoutsSec.review
  ctx.m.dispatch({ type: 'START_CAPTURE' })
  for (let i = 0; i < shots; i++) {
    await tick(countdownSec * 1000) // Countdown → Shooting → (capture resolves) → Review
    await tick(review * 1000) // Review → next shot / Compose
  }
  await tick() // Compose → Print → ShowQR (stubs resolve immediately)
}

describe('kiosk mode — happy path', () => {
  it('goes Idle → pay → template → capture N shots → Compose → Print → ShowQR → Idle', async () => {
    const ctx = setup({ mode: 'kiosk' })
    await toWaitPayment(ctx, 2)
    expect(ctx.m.snapshot.state).toBe('WaitPayment')
    expect(ctx.m.snapshot.payment?.amount).toBe(250)

    ctx.payment.simulatePaid(ctx.m.snapshot.payment!.chargeId)
    await tick()
    expect(ctx.m.snapshot.state).toBe('SelectTemplate')
    expect(ctx.relay.state.get(3)).toBe(true) // CH3 paid light

    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id: 't3' })
    expect(ctx.m.snapshot.state).toBe('Instruction')
    await shootAll(ctx, 3)
    expect(ctx.m.snapshot.state).toBe('ShowQR')
    expect(ctx.camera.captured.map((p) => basename(p))).toEqual(['01.jpg', '02.jpg', '03.jpg'])
    expect(ctx.m.snapshot.session?.captures).toEqual([
      'booth://capture/S1/01.jpg',
      'booth://capture/S1/02.jpg',
      'booth://capture/S1/03.jpg'
    ])
    // compose got the 3 captures in order and wrote the 2x6 print file
    expect(ctx.composer.calls).toEqual([
      {
        id: 't3',
        photos: ['01.jpg', '02.jpg', '03.jpg'].map((f) => join('/tmp/S1/captures', f)),
        out: join('/tmp/S1', 'S1-print2x6.jpg')
      }
    ])
    // PRN-4: printed the paid quantity (2)
    expect(ctx.printer.jobs).toEqual([{ file: join('/tmp/S1', 'S1-print2x6.jpg'), copies: 2 }])
    expect(ctx.m.snapshot.session?.printUrl).toBe('booth://print/S1/S1-print2x6.jpg')
    expect(ctx.store.records[0]!.print).toEqual({ file: 'S1-print2x6.jpg', copies: 2, status: 'printed' })
    expect(ctx.states).toEqual(expect.arrayContaining(['Compose', 'Print', 'ShowQR']))

    ctx.m.dispatch({ type: 'FINISH' })
    await tick()
    expect(ctx.m.snapshot.state).toBe('Idle')
    expect(ctx.store.records[0]!.status).toBe('completed')
    expect(ctx.store.records[0]!.payment?.status).toBe('paid')
    expect(ctx.relay.state.get(2)).toBe(false)
    expect(ctx.relay.state.get(3)).toBe(false)
  })

  it('uses the configured price table (1→130 … 4→500)', async () => {
    for (const [qty, price] of [[1, 130], [2, 250], [3, 375], [4, 500]] as const) {
      const ctx = setup()
      await toWaitPayment(ctx, qty)
      expect(ctx.m.snapshot.payment?.amount).toBe(price)
      vi.useRealTimers()
    }
  })

  it('ignores a quantity that has no price', async () => {
    const ctx = setup()
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'CHOOSE_PROMPTPAY' })
    ctx.m.dispatch({ type: 'SELECT_QTY', qty: 9 })
    await tick()
    expect(ctx.m.snapshot.state).toBe('SelectQty')
  })
})

describe('event mode', () => {
  it('skips payment and goes straight to template selection', async () => {
    const ctx = setup({ mode: 'event' })
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    expect(ctx.m.snapshot.state).toBe('SelectTemplate')
    expect(ctx.states).not.toContain('SelectPayment')
    expect(ctx.store.records[0]!.payment).toBeNull()
  })

  it('returns to Idle when the guest leaves the template screen', async () => {
    const ctx = setup({ mode: 'event' })
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    await tick(ctx.config.timeoutsSec.selectTemplate * 1000)
    expect(ctx.m.snapshot.state).toBe('Idle')
    expect(ctx.camera.captured).toHaveLength(0)
  })
})

describe('devices are checked before payment (CAM-8 / BR-01 draft)', () => {
  it('camera not ready → power-cycle CH4 → still not ready → DeviceError, no payment screen', async () => {
    const ctx = setup()
    ctx.camera.detectResults = [
      { ready: false, error: 'not found' },
      { ready: false, error: 'not found' },
      { ready: false, error: 'not found' }
    ]
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    const pc = ctx.config.camera.powerCycle
    await tick((pc.offMs + pc.bootMs) * pc.maxAttempts)
    expect(ctx.m.snapshot.state).toBe('DeviceError')
    expect(ctx.m.snapshot.error?.code).toBe('CAMERA_NOT_READY')
    expect(ctx.states).not.toContain('SelectPayment')
    expect(ctx.store.records).toHaveLength(0)
    const cycles = ctx.logger.entries.filter((e) => e.event === 'camera.power_cycle')
    expect(cycles).toHaveLength(pc.maxAttempts)

    await tick(ctx.config.timeoutsSec.deviceError * 1000)
    expect(ctx.m.snapshot.state).toBe('Idle')
  })

  it('camera recovers after one power-cycle → continues to payment', async () => {
    const ctx = setup()
    ctx.camera.detectResults = [{ ready: false, error: 'not found' }, { ready: true, model: 'stub' }]
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    const pc = ctx.config.camera.powerCycle
    await tick(pc.offMs + pc.bootMs)
    expect(ctx.m.snapshot.state).toBe('SelectPayment')
  })

  it('printer not ready → DeviceError, no payment screen', async () => {
    const ctx = setup()
    ctx.printer.ready = false
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    expect(ctx.m.snapshot.state).toBe('DeviceError')
    expect(ctx.m.snapshot.error?.code).toBe('PRINTER_NOT_READY')
    expect(ctx.states).not.toContain('SelectPayment')
  })
})

describe('timeouts (UI-3)', () => {
  it('SelectPayment timeout → Idle and session cancelled', async () => {
    const ctx = setup()
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    await tick(ctx.config.timeoutsSec.selectPayment * 1000)
    expect(ctx.m.snapshot.state).toBe('Idle')
    expect(ctx.store.records[0]!.status).toBe('cancelled')
  })

  it('activity resets the SelectQty timeout', async () => {
    const ctx = setup()
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'CHOOSE_PROMPTPAY' })
    const t = ctx.config.timeoutsSec.selectQty * 1000
    await tick(t - 1000)
    ctx.m.dispatch({ type: 'ACTIVITY' })
    await tick(t - 1000)
    expect(ctx.m.snapshot.state).toBe('SelectQty')
    await tick(1000)
    expect(ctx.m.snapshot.state).toBe('Idle')
  })

  it('QR expiry → charge cancelled → Idle', async () => {
    const ctx = setup()
    await toWaitPayment(ctx)
    await tick(ctx.config.payment.qrExpirySec * 1000)
    expect(ctx.m.snapshot.state).toBe('Idle')
    expect(ctx.store.records[0]!.payment?.status).toBe('expired')
  })

  it('after payment, template timeout auto-picks instead of dropping the customer (BR-02 draft)', async () => {
    const ctx = setup()
    await toWaitPayment(ctx)
    ctx.payment.simulatePaid(ctx.m.snapshot.payment!.chargeId)
    await tick()
    ctx.m.dispatch({ type: 'HIGHLIGHT_TEMPLATE', id: 't1' })
    await tick(ctx.config.timeoutsSec.selectTemplate * 1000)
    expect(ctx.m.snapshot.state).toBe('Instruction')
    expect(ctx.store.records[0]!.templateId).toBe('t1')
    await tick(ctx.config.timeoutsSec.instruction * 1000)
    expect(ctx.m.snapshot.state).toBe('Countdown')
  })
})

describe('cancel payment (PAY-3)', () => {
  it('asks for confirmation; "no" returns to the same QR', async () => {
    const ctx = setup()
    await toWaitPayment(ctx)
    const chargeId = ctx.m.snapshot.payment!.chargeId
    ctx.m.dispatch({ type: 'CANCEL_REQUEST' })
    expect(ctx.m.snapshot.state).toBe('ConfirmCancel')
    ctx.m.dispatch({ type: 'BACK' })
    expect(ctx.m.snapshot.state).toBe('WaitPayment')
    expect(ctx.m.snapshot.payment!.chargeId).toBe(chargeId)
  })

  it('confirm → charge cancelled → Idle', async () => {
    const ctx = setup()
    await toWaitPayment(ctx)
    ctx.m.dispatch({ type: 'CANCEL_REQUEST' })
    ctx.m.dispatch({ type: 'CONFIRM_CANCEL' })
    await tick()
    expect(ctx.m.snapshot.state).toBe('Idle')
    expect(ctx.store.records[0]!.payment?.status).toBe('cancelled')
  })

  it('confirmation dialog times out back to the QR', async () => {
    const ctx = setup()
    await toWaitPayment(ctx)
    ctx.m.dispatch({ type: 'CANCEL_REQUEST' })
    await tick(ctx.config.timeoutsSec.confirmCancel * 1000)
    expect(ctx.m.snapshot.state).toBe('WaitPayment')
  })

  it('payment that arrives while the confirmation is open still counts', async () => {
    const ctx = setup()
    await toWaitPayment(ctx)
    ctx.m.dispatch({ type: 'CANCEL_REQUEST' })
    ctx.payment.simulatePaid(ctx.m.snapshot.payment!.chargeId)
    await tick()
    expect(ctx.m.snapshot.state).toBe('SelectTemplate')
  })

  it('payment that arrives after cancel is recorded as orphan (PAY-7)', async () => {
    const ctx = setup()
    await toWaitPayment(ctx)
    const chargeId = ctx.m.snapshot.payment!.chargeId
    ctx.m.dispatch({ type: 'CANCEL_REQUEST' })
    ctx.m.dispatch({ type: 'CONFIRM_CANCEL' })
    await tick()
    ctx.payment.simulatePaid(chargeId)
    await tick()
    expect(ctx.m.snapshot.state).toBe('Idle')
    expect(ctx.store.orphans).toEqual([chargeId])
  })
})

describe('capture failures', () => {
  it('retries once, then succeeds', async () => {
    const ctx = setup({ mode: 'event' })
    let calls = 0
    ctx.camera.captureImpl = async () => {
      if (++calls === 1) throw new Error('busy')
    }
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id: 't1' })
    ctx.m.dispatch({ type: 'START_CAPTURE' })
    await tick(ctx.config.capture.countdownSec * 1000) // first attempt fails → Countdown again
    await tick(ctx.config.capture.countdownSec * 1000) // second attempt ok
    expect(ctx.m.snapshot.state).toBe('Review')
  })

  it('fails after retries on a PAID session → Error marked paid, session status error', async () => {
    const ctx = setup()
    ctx.camera.captureImpl = async () => {
      throw new Error('camera disconnected')
    }
    await toWaitPayment(ctx)
    ctx.payment.simulatePaid(ctx.m.snapshot.payment!.chargeId)
    await tick()
    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id: 't1' })
    ctx.m.dispatch({ type: 'START_CAPTURE' })
    await tick(ctx.config.capture.countdownSec * 1000 * (ctx.config.capture.retries + 1))
    expect(ctx.m.snapshot.state).toBe('Error')
    expect(ctx.m.snapshot.error).toMatchObject({ code: 'CAPTURE_FAILED', paid: true })
    expect(ctx.store.records[0]!.status).toBe('error')
    expect(ctx.store.records[0]!.payment?.status).toBe('paid')
  })

  it('a capture that hangs times out', async () => {
    const ctx = setup({ mode: 'event', capture: { retries: 0 } })
    ctx.camera.captureImpl = () => new Promise(() => {})
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id: 't1' })
    ctx.m.dispatch({ type: 'START_CAPTURE' })
    await tick(ctx.config.capture.countdownSec * 1000)
    expect(ctx.m.snapshot.state).toBe('Shooting')
    await tick(ctx.config.timeoutsSec.shooting * 1000)
    expect(ctx.m.snapshot.state).toBe('Error')
  })
})

describe('UI events in the wrong state are ignored', () => {
  it('SELECT_QTY on Idle does nothing', async () => {
    const ctx = setup()
    await ctx.m.start()
    ctx.m.dispatch({ type: 'SELECT_QTY', qty: 1 })
    ctx.m.dispatch({ type: 'DEV_SIMULATE_PAID' })
    await tick()
    expect(ctx.m.snapshot.state).toBe('Idle')
    expect(ctx.store.records).toHaveLength(0)
  })

  it('unknown template id is ignored', async () => {
    const ctx = setup({ mode: 'event' })
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id: 'nope' })
    expect(ctx.m.snapshot.state).toBe('SelectTemplate')
  })
})

describe('templates offered to customers', () => {
  it('hidden (seasonal) templates are not offered and cannot be selected', async () => {
    const ctx = setup({ mode: 'event' })
    expect(ctx.m.snapshot.templates.map((t) => t.id)).toEqual(['t4', 't3', 't1'])
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id: '.hidden' })
    expect(ctx.m.snapshot.state).toBe('SelectTemplate')
  })
})

describe('compose + print (IMG-3, PRN-4, PRN-8)', () => {
  async function toCompose(ctx: ReturnType<typeof setup>) {
    await ctx.m.start()
    ctx.m.dispatch({ type: 'TOUCH' })
    await tick()
    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id: 't1' })
    ctx.m.dispatch({ type: 'START_CAPTURE' })
    await tick(ctx.config.capture.countdownSec * 1000)
    await tick(ctx.config.timeoutsSec.review * 1000)
  }

  it('event mode prints event.printCopies copies', async () => {
    const ctx = setup({ mode: 'event', event: { printCopies: 2 } })
    await toCompose(ctx)
    await tick()
    expect(ctx.m.snapshot.state).toBe('ShowQR')
    expect(ctx.printer.jobs[0]!.copies).toBe(2)
  })

  it('compose failure → Error (paid), nothing printed', async () => {
    const ctx = setup({ mode: 'event' })
    ctx.composer.impl = async () => {
      throw new Error('disk full')
    }
    await toCompose(ctx)
    await tick()
    expect(ctx.m.snapshot.state).toBe('Error')
    expect(ctx.m.snapshot.error).toMatchObject({ code: 'COMPOSE_FAILED', paid: true })
    expect(ctx.printer.jobs).toHaveLength(0)
  })

  it('print failure on a PAID kiosk session → Error, print job kept as failed for reprint (PRN-8)', async () => {
    const ctx = setup()
    ctx.printer.printImpl = async () => {
      throw new Error('paper jam')
    }
    await toWaitPayment(ctx, 3)
    ctx.payment.simulatePaid(ctx.m.snapshot.payment!.chargeId)
    await tick()
    ctx.m.dispatch({ type: 'SELECT_TEMPLATE', id: 't1' })
    ctx.m.dispatch({ type: 'START_CAPTURE' })
    await tick(ctx.config.capture.countdownSec * 1000)
    await tick(ctx.config.timeoutsSec.review * 1000)
    await tick()
    expect(ctx.m.snapshot.state).toBe('Error')
    expect(ctx.m.snapshot.error).toMatchObject({ code: 'PRINT_FAILED', paid: true })
    expect(ctx.store.records[0]!.print).toEqual({ file: 'S1-print4x6.jpg', copies: 3, status: 'failed' })
    expect(ctx.store.records[0]!.status).toBe('error')
  })

  it('a print that hangs times out → Error, job marked failed', async () => {
    const ctx = setup({ mode: 'event' })
    ctx.printer.printImpl = () => new Promise(() => {})
    await toCompose(ctx)
    await tick()
    expect(ctx.m.snapshot.state).toBe('Print')
    await tick(ctx.config.timeoutsSec.print * 1000)
    expect(ctx.m.snapshot.state).toBe('Error')
    expect(ctx.store.records[0]!.print?.status).toBe('failed')
  })
})
