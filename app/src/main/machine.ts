import { join } from 'node:path'
import type { BoothConfig } from './config'
import type { CameraDriver, CameraStatus } from './drivers/camera'
import type { PaymentProvider } from './drivers/payment'
import type { PrinterDriver } from './drivers/printer'
import type { RelayDriver } from './drivers/relay'
import type { Logger } from './logger'
import { priceFor } from './pricing'
import type { SessionRecord, SessionStore } from './session'
import type { ErrorView, PaymentView, Snapshot, StateName, UiEvent } from '../shared/types'

export interface MachineDeps {
  config: BoothConfig
  camera: CameraDriver
  printer: PrinterDriver
  payment: PaymentProvider
  relay: RelayDriver
  store: SessionStore
  logger: Logger
  /** builds the URL the UI uses to show a captured file */
  captureUrl: (sessionId: string, fileName: string) => string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const PRE_PAYMENT: StateName[] = ['SelectPayment', 'SelectQty']

/**
 * Booth session state machine (PRD v1.2 section 5).
 *
 * Rules enforced here:
 *  - CAM-8 / BR-01 (draft): camera + printer are checked BEFORE any payment screen.
 *  - BR-02 (draft): after payment, timeouts move the session forward, never back to Idle.
 *  - PAY-3: cancelling a pending payment asks for confirmation; a payment that
 *    arrives during the confirmation still counts.
 *  - Every async step checks `epoch` so results that arrive after the state
 *    changed are ignored (old system crashed on this — PRD archive 6.6).
 */
export class BoothMachine {
  private snap: Snapshot
  private record: SessionRecord | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private epoch = 0
  private shotAttempt = 0
  private listeners: ((s: Snapshot) => void)[] = []
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private d: MachineDeps) {
    this.now = d.now ?? Date.now
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    const c = d.config
    this.snap = {
      state: 'Idle',
      mode: c.mode,
      deadline: null,
      prices: c.prices,
      currency: c.currency,
      templates: c.templates,
      selectedTemplateId: c.templates[0]?.id ?? null,
      session: null,
      payment: null,
      error: null,
      liveView: { source: d.camera.liveViewSource, mirror: c.capture.mirrorLiveView },
      devPayment: d.payment.id === 'mock'
    }
    d.payment.onPaid((chargeId) => this.onPaid(chargeId))
  }

  get snapshot(): Snapshot {
    return this.snap
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.push(fn)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn)
    }
  }

  async start(): Promise<void> {
    await this.relay('cabinetLight', true)
    this.enter('Idle')
  }

  dispatch(ev: UiEvent): void {
    const s = this.snap.state
    this.d.logger.log('debug', 'ui.event', { state: s, event: ev.type })

    if (ev.type === 'ACTIVITY') {
      if (PRE_PAYMENT.includes(s) || s === 'SelectTemplate') this.armTimer(s)
      return
    }

    switch (s) {
      case 'Idle':
        if (ev.type === 'TOUCH') this.enter('CheckDevices')
        break
      case 'SelectPayment':
        if (ev.type === 'CHOOSE_PROMPTPAY') this.enter('SelectQty')
        else if (ev.type === 'BACK') this.endSession('cancelled', 'customer left at payment selection')
        break
      case 'SelectQty':
        if (ev.type === 'SELECT_QTY') void this.createCharge(ev.qty)
        else if (ev.type === 'BACK') this.enter('SelectPayment')
        break
      case 'WaitPayment':
        if (ev.type === 'CANCEL_REQUEST') this.enter('ConfirmCancel', { keepDeadline: true })
        else if (ev.type === 'DEV_SIMULATE_PAID') this.devSimulatePaid()
        break
      case 'ConfirmCancel':
        if (ev.type === 'CONFIRM_CANCEL') void this.cancelPayment('cancelled')
        else if (ev.type === 'BACK') this.enter('WaitPayment', { keepDeadline: true })
        else if (ev.type === 'DEV_SIMULATE_PAID') this.devSimulatePaid()
        break
      case 'SelectTemplate':
        if (ev.type === 'HIGHLIGHT_TEMPLATE' && this.templateExists(ev.id)) {
          this.snap = { ...this.snap, selectedTemplateId: ev.id }
          this.armTimer(s)
          this.emit()
        } else if (ev.type === 'SELECT_TEMPLATE' && this.templateExists(ev.id)) {
          this.chooseTemplate(ev.id, 'customer')
        }
        break
      case 'Instruction':
        if (ev.type === 'START_CAPTURE') this.beginShot(1)
        break
      case 'ShowQR':
        if (ev.type === 'FINISH') this.endSession('completed', 'customer finished')
        break
      default:
        // states driven by timers/async work ignore UI events
        break
    }
  }

  // ---------------------------------------------------------------- states

  private enter(state: StateName, opts: { keepDeadline?: boolean } = {}): void {
    this.clearTimer()
    this.epoch++
    const prevDeadline = this.snap.deadline
    this.snap = { ...this.snap, state }
    this.d.logger.log('info', 'state.enter', { state, session: this.record?.sessionId })
    if (opts.keepDeadline && prevDeadline !== null) this.armTimerAt(state, prevDeadline)
    else this.armTimer(state)
    this.emit()

    const epoch = this.epoch
    if (state === 'Idle') void this.onIdle()
    if (state === 'CheckDevices') void this.checkDevices(epoch)
    if (state === 'Shooting') void this.shoot(epoch)
  }

  private async onIdle(): Promise<void> {
    this.record = null
    this.snap = { ...this.snap, session: null, payment: null, error: null, selectedTemplateId: this.d.config.templates[0]?.id ?? null }
    this.emit()
    await this.relay('paid', false)
    await this.relay('sessionActive', false)
  }

  private async checkDevices(epoch: number): Promise<void> {
    const cam = await this.detectCameraWithRecovery(epoch)
    if (epoch !== this.epoch) return
    if (!cam.ready) return this.deviceError('CAMERA_NOT_READY', `กล้องไม่พร้อม: ${cam.error ?? 'unknown'}`)

    let printer
    try {
      printer = await this.d.printer.status()
    } catch (e) {
      printer = { ready: false, error: String(e) }
    }
    if (epoch !== this.epoch) return
    if (!printer.ready) return this.deviceError('PRINTER_NOT_READY', `ปริ้นเตอร์ไม่พร้อม: ${printer.error ?? 'unknown'}`)

    const rec = this.d.store.create(this.d.config.mode, new Date(this.now()))
    this.record = rec
    this.note('session.start', `camera=${cam.model ?? '?'} printer=${printer.model ?? '?'}`)
    this.snap = { ...this.snap, session: { sessionId: rec.sessionId, templateId: null, shotsTotal: 0, shotIndex: 0, captures: [] } }
    await this.relay('sessionActive', true)
    if (epoch !== this.epoch) return

    if (this.d.config.mode === 'kiosk') this.enter('SelectPayment')
    else this.enter('SelectTemplate') // MODE-3: event mode skips payment (details pending User)
  }

  /** CAM-7: if the camera is missing, power-cycle it via relay CH4 and retry. */
  private async detectCameraWithRecovery(epoch: number): Promise<CameraStatus> {
    const pc = this.d.config.camera.powerCycle
    let status = await this.safeDetect()
    let attempt = 0
    while (!status.ready && pc.enabled && attempt < pc.maxAttempts && epoch === this.epoch) {
      attempt++
      this.d.logger.log('warn', 'camera.power_cycle', { attempt, error: status.error })
      await this.relay('cameraPower', false)
      await this.sleep(pc.offMs)
      await this.relay('cameraPower', true)
      await this.sleep(pc.bootMs)
      status = await this.safeDetect()
    }
    return status
  }

  private async safeDetect(): Promise<CameraStatus> {
    try {
      return await this.d.camera.detect()
    } catch (e) {
      return { ready: false, error: String(e) }
    }
  }

  private deviceError(code: string, message: string): void {
    this.d.logger.log('error', 'device.not_ready', { code, message })
    this.snap = { ...this.snap, error: { code, message, paid: false } }
    this.enter('DeviceError')
  }

  private async createCharge(qty: number): Promise<void> {
    let amount: number
    try {
      amount = priceFor(qty, this.d.config.prices)
    } catch (e) {
      this.d.logger.log('warn', 'payment.invalid_qty', { qty })
      return
    }
    this.enter('CreatingCharge')
    const epoch = this.epoch
    const rec = this.record
    if (!rec) return this.fail('NO_SESSION', 'ไม่มี session', false)
    try {
      const charge = await this.d.payment.createCharge({
        amount,
        currency: this.d.config.currency,
        reference: rec.sessionId,
        expiresInSec: this.d.config.payment.qrExpirySec
      })
      if (epoch !== this.epoch) {
        // state moved on (e.g. timeout) while the QR was being created — don't leave a live charge behind
        await this.d.payment.cancelCharge(charge.chargeId)
        return
      }
      rec.payment = { provider: this.d.payment.id, chargeId: charge.chargeId, qty, amount, status: 'pending' }
      this.note('payment.created', `${charge.chargeId} qty=${qty} amount=${amount}`)
      const view: PaymentView = {
        provider: this.d.payment.id,
        chargeId: charge.chargeId,
        qty,
        amount,
        currency: this.d.config.currency,
        qrPayload: charge.qrPayload,
        expiresAt: charge.expiresAt
      }
      this.snap = { ...this.snap, payment: view, deadline: charge.expiresAt }
      this.enter('WaitPayment', { keepDeadline: true })
    } catch (e) {
      if (epoch !== this.epoch) return
      this.fail('PAYMENT_CREATE_FAILED', `สร้าง QR ไม่สำเร็จ: ${String(e)}`, false)
    }
  }

  private onPaid(chargeId: string): void {
    const p = this.record?.payment
    const s = this.snap.state
    const waiting = s === 'WaitPayment' || s === 'ConfirmCancel'
    if (!p || p.chargeId !== chargeId || p.status !== 'pending' || !waiting) {
      // PAY-7: money arrived but the booth is not waiting for it → keep evidence for compensation
      this.d.logger.log('error', 'payment.orphan', { chargeId, state: s })
      this.d.store.recordOrphanPayment(chargeId, new Date(this.now()))
      return
    }
    p.status = 'paid'
    this.record!.status = 'paid'
    this.note('payment.paid', chargeId)
    void this.relay('paid', true)
    this.enter('SelectTemplate')
  }

  private devSimulatePaid(): void {
    const id = this.snap.payment?.chargeId
    const provider = this.d.payment as PaymentProvider & { simulatePaid?: (id: string) => void }
    if (id && provider.simulatePaid) provider.simulatePaid(id)
  }

  private async cancelPayment(reason: 'cancelled' | 'expired'): Promise<void> {
    const p = this.record?.payment
    if (p && p.status === 'pending') {
      p.status = reason
      try {
        await this.d.payment.cancelCharge(p.chargeId)
      } catch (e) {
        this.d.logger.log('error', 'payment.cancel_failed', { chargeId: p.chargeId, error: String(e) })
      }
    }
    this.endSession('cancelled', `payment ${reason}`)
  }

  private templateExists(id: string): boolean {
    return this.d.config.templates.some((t) => t.id === id)
  }

  private chooseTemplate(id: string, by: 'customer' | 'timeout'): void {
    const t = this.d.config.templates.find((x) => x.id === id)
    if (!t || !this.record) return
    this.record.templateId = t.id
    this.note('template.selected', `${t.id} by=${by}`)
    this.snap = {
      ...this.snap,
      selectedTemplateId: t.id,
      session: { ...this.snap.session!, templateId: t.id, shotsTotal: t.shots, shotIndex: 0, captures: [] }
    }
    this.enter('Instruction')
  }

  private beginShot(index: number): void {
    this.shotAttempt = 0
    this.snap = { ...this.snap, session: { ...this.snap.session!, shotIndex: index } }
    this.enter('Countdown')
  }

  private async shoot(epoch: number): Promise<void> {
    const rec = this.record
    const sv = this.snap.session
    if (!rec || !sv) return this.fail('NO_SESSION', 'ไม่มี session', this.isPaid())
    const fileName = `${String(sv.shotIndex).padStart(2, '0')}.jpg`
    try {
      await this.d.camera.capture(join(this.d.store.captureDir(rec), fileName))
      if (epoch !== this.epoch) return
      rec.captures[sv.shotIndex - 1] = fileName
      this.note('capture.ok', fileName)
      const captures = [...sv.captures]
      captures[sv.shotIndex - 1] = this.d.captureUrl(rec.sessionId, fileName)
      this.snap = { ...this.snap, session: { ...sv, captures } }
      this.enter('Review')
    } catch (e) {
      if (epoch !== this.epoch) return
      this.captureFailed(String(e))
    }
  }

  private captureFailed(error: string): void {
    this.d.logger.log('error', 'capture.failed', { attempt: this.shotAttempt, error })
    if (this.shotAttempt < this.d.config.capture.retries) {
      this.shotAttempt++
      this.enter('Countdown')
      return
    }
    this.fail('CAPTURE_FAILED', `ถ่ายภาพไม่สำเร็จ: ${error}`, this.isPaid())
  }

  private isPaid(): boolean {
    return this.d.config.mode === 'event' ? this.record !== null : this.record?.payment?.status === 'paid'
  }

  private fail(code: string, message: string, paid: boolean): void {
    const error: ErrorView = { code, message, paid }
    this.d.logger.log('error', 'session.error', { code, message, paid, session: this.record?.sessionId })
    if (this.record) {
      this.record.status = 'error'
      this.note('error', `${code}: ${message}${paid ? ' (PAID — needs compensation)' : ''}`)
    }
    this.snap = { ...this.snap, error }
    this.enter('Error')
  }

  private endSession(status: 'completed' | 'cancelled', why: string): void {
    if (this.record) {
      if (this.record.status !== 'error') this.record.status = status
      this.note('session.end', why)
    }
    this.enter('Idle')
  }

  // ---------------------------------------------------------------- timers

  private timeoutMs(state: StateName): number | null {
    const t = this.d.config.timeoutsSec
    const map: Partial<Record<StateName, number>> = {
      SelectPayment: t.selectPayment,
      SelectQty: t.selectQty,
      CreatingCharge: t.creatingCharge,
      ConfirmCancel: t.confirmCancel,
      SelectTemplate: t.selectTemplate,
      Instruction: t.instruction,
      Countdown: this.d.config.capture.countdownSec,
      Shooting: t.shooting,
      Review: t.review,
      ShowQR: t.showQr,
      Error: t.error,
      DeviceError: t.deviceError
    }
    const sec = map[state]
    return sec === undefined ? null : sec * 1000
  }

  private armTimer(state: StateName): void {
    if (state === 'WaitPayment' && this.snap.payment) return this.armTimerAt(state, this.snap.payment.expiresAt)
    const ms = this.timeoutMs(state)
    if (ms === null) {
      this.clearTimer()
      this.snap = { ...this.snap, deadline: null }
      return
    }
    this.armTimerAt(state, this.now() + ms)
  }

  private armTimerAt(state: StateName, deadline: number): void {
    this.clearTimer()
    // ConfirmCancel keeps the QR expiry visible but has its own short timeout back to WaitPayment
    const own = state === 'ConfirmCancel' ? this.now() + (this.timeoutMs('ConfirmCancel') ?? 0) : deadline
    const fireAt = Math.min(own, deadline)
    this.snap = { ...this.snap, deadline }
    const epoch = this.epoch
    this.timer = setTimeout(() => {
      if (epoch === this.epoch) this.onTimeout(state, fireAt === deadline)
    }, Math.max(0, fireAt - this.now()))
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private onTimeout(state: StateName, deadlineReached: boolean): void {
    this.d.logger.log('info', 'state.timeout', { state })
    switch (state) {
      case 'SelectPayment':
      case 'SelectQty':
        return this.endSession('cancelled', `timeout at ${state}`)
      case 'CreatingCharge':
        return this.fail('PAYMENT_CREATE_TIMEOUT', 'สร้าง QR ไม่ทันเวลา', false)
      case 'WaitPayment':
        return void this.cancelPayment('expired')
      case 'ConfirmCancel':
        // QR expired while asking → cancel; otherwise go back to the QR
        return deadlineReached ? void this.cancelPayment('expired') : this.enter('WaitPayment', { keepDeadline: true })
      case 'SelectTemplate': {
        // event mode: nobody paid, the guest walked away → back to Idle
        if (this.d.config.mode === 'event') return this.endSession('cancelled', 'timeout at SelectTemplate')
        // kiosk, BR-02: already paid → never drop the customer, auto-pick the highlighted template
        const id = this.snap.selectedTemplateId ?? this.d.config.templates[0]!.id
        return this.chooseTemplate(id, 'timeout')
      }
      case 'Instruction':
        return this.beginShot(1)
      case 'Countdown':
        return this.enter('Shooting')
      case 'Shooting':
        return this.captureFailed('capture timeout')
      case 'Review': {
        const sv = this.snap.session!
        return sv.shotIndex < sv.shotsTotal ? this.beginShot(sv.shotIndex + 1) : this.finishCapture()
      }
      case 'ShowQR':
        return this.endSession('completed', 'timeout at ShowQR')
      case 'Error':
      case 'DeviceError':
        return this.enter('Idle')
      default:
        return
    }
  }

  private finishCapture(): void {
    // M1-2 adds Compose → Print here; M3 adds upload + real download QR.
    this.note('capture.done', `${this.record?.captures.length ?? 0} shots`)
    this.enter('ShowQR')
  }

  // ---------------------------------------------------------------- helpers

  private note(event: string, detail?: string): void {
    if (!this.record) return
    this.record.events.push({ at: new Date(this.now()).toISOString(), event, detail })
    try {
      this.d.store.save(this.record)
    } catch (e) {
      this.d.logger.log('error', 'session.save_failed', { error: String(e) })
    }
  }

  private async relay(name: keyof BoothConfig['relay']['channels'], on: boolean): Promise<void> {
    try {
      await this.d.relay.set(this.d.config.relay.channels[name], on)
    } catch (e) {
      this.d.logger.log('error', 'relay.failed', { name, on, error: String(e) })
    }
  }

  private emit(): void {
    for (const l of this.listeners) l(this.snap)
  }
}
