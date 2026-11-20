import { join } from 'node:path'
import type { BoothConfig } from './config'
import type { CameraDriver, CameraStatus } from './drivers/camera'
import type { PaymentProvider } from './drivers/payment'
import type { PrinterDriver } from './drivers/printer'
import type { RelayDriver } from './drivers/relay'
import type { Logger } from './logger'
import { priceFor } from './pricing'
import { upscaleFactor } from '../shared/camera'
import type { SessionRecord, SessionStore } from './session'
import type { TemplateDef } from './templates'
import type { ErrorView, PaymentView, Snapshot, StateName, TemplateInfo, UiEvent } from '../shared/types'

export interface MachineDeps {
  config: BoothConfig
  camera: CameraDriver
  printer: PrinterDriver
  payment: PaymentProvider
  relay: RelayDriver
  store: SessionStore
  logger: Logger
  /** templates loaded from paths.templatesDir; only `visible` ones are offered to customers */
  templates: TemplateDef[]
  /** IMG-3: compose captured photos into the template → JPEG at outPath */
  compose: (t: TemplateDef, photoPaths: string[], outPath: string) => Promise<void>
  /** URLs the UI uses to show files */
  urls: {
    capture: (sessionId: string, fileName: string) => string
    print: (sessionId: string, fileName: string) => string
    preview: (templateId: string) => string
  }
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const PRE_PAYMENT: StateName[] = ['SelectPayment', 'SelectQty']

/**
 * Booth session state machine (PRD v1.3 section 5).
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
  /** CAM-5: customer retakes used on the current shot */
  private retakesUsed = 0
  private listeners: ((s: Snapshot) => void)[] = []
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly offered: TemplateDef[]
  /** frame size reported by the camera at the last device check (webcam/mock) */
  private cameraSize: { w: number; h: number } | null = null

  constructor(private d: MachineDeps) {
    this.now = d.now ?? Date.now
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    const c = d.config
    this.offered = d.templates.filter((t) => t.visible)
    if (this.offered.length === 0) throw new Error('no visible templates to offer')
    const templates: TemplateInfo[] = this.offered.map((t) => ({
      id: t.id,
      name: t.name,
      size: t.size,
      shots: t.photos.length,
      previewUrl: t.previewPath ? d.urls.preview(t.id) : null
    }))
    this.snap = {
      state: 'Idle',
      mode: c.mode,
      deadline: null,
      prices: c.prices,
      currency: c.currency,
      templates,
      selectedTemplateId: templates[0]!.id,
      session: null,
      payment: null,
      error: null,
      liveView: {
        source: d.camera.liveViewSource,
        mirror: c.capture.mirrorLiveView,
        rotation: c.camera.rotation as 0 | 90 | 180 | 270,
        webcam: { ...c.camera.webcam }
      },
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
    // ACTIVITY fires on every tap — not logged (PRD NFR Logging: reduce noise, ISS-003)
    if (ev.type !== 'ACTIVITY') this.d.logger.log('debug', 'ui.event', { state: s, ui: ev.type })

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
      case 'Review':
        if (ev.type === 'ACCEPT_SHOT') this.acceptShot()
        else if (ev.type === 'RETAKE') this.retakeShot()
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
    if (state === 'Compose') void this.compose(epoch)
    if (state === 'Print') void this.print(epoch)
  }

  private async onIdle(): Promise<void> {
    this.record = null
    this.snap = { ...this.snap, session: null, payment: null, error: null, selectedTemplateId: this.offered[0]!.id }
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

    this.cameraSize = cam.width && cam.height ? { w: cam.width, h: cam.height } : null
    this.d.logger.log('info', 'camera.ready', { model: cam.model, width: cam.width, height: cam.height, devices: cam.devices, exposure: cam.exposure })

    const rec = this.d.store.create(this.d.config.mode, new Date(this.now()))
    this.record = rec
    this.note('session.start', `camera=${cam.model ?? '?'} printer=${printer.model ?? '?'}`)
    this.snap = { ...this.snap, session: { sessionId: rec.sessionId, templateId: null, shotsTotal: 0, shotIndex: 0, captures: [], printUrl: null, copies: 0, retakesLeft: 0 } }
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
    return this.offered.some((t) => t.id === id)
  }

  private chooseTemplate(id: string, by: 'customer' | 'timeout'): void {
    const t = this.offered.find((x) => x.id === id)
    if (!t || !this.record) return
    this.record.templateId = t.id
    this.note('template.selected', `${t.id} by=${by}`)
    this.checkResolution(t)
    this.snap = {
      ...this.snap,
      selectedTemplateId: t.id,
      session: { ...this.snap.session!, templateId: t.id, shotsTotal: t.photos.length, shotIndex: 0, captures: [] }
    }
    this.enter('Instruction')
  }

  /** Warn (not block) when the camera frame is too small for the template's slots — prints would be soft. */
  private checkResolution(t: TemplateDef): void {
    if (!this.cameraSize) return
    const worst = Math.max(...t.photos.map((p) => upscaleFactor(this.cameraSize!.w, this.cameraSize!.h, p.w, p.h)))
    if (worst > 1) {
      const detail = `${this.cameraSize.w}x${this.cameraSize.h} needs x${worst.toFixed(2)} upscale for ${t.id}`
      this.d.logger.log('warn', 'capture.low_resolution', { template: t.id, width: this.cameraSize.w, height: this.cameraSize.h, upscale: +worst.toFixed(2) })
      this.note('capture.low_resolution', detail)
    }
  }

  private beginShot(index: number): void {
    this.shotAttempt = 0
    this.retakesUsed = 0
    this.snap = { ...this.snap, session: { ...this.snap.session!, shotIndex: index, retakesLeft: this.d.config.capture.maxRetakes } }
    this.enter('Countdown')
  }

  /** Review → next shot, or Compose after the last one (customer tap or Review timeout). */
  private acceptShot(): void {
    const sv = this.snap.session!
    if (sv.shotIndex < sv.shotsTotal) this.beginShot(sv.shotIndex + 1)
    else this.finishCapture()
  }

  /** CAM-5: customer rejects the shot → old file kept in captures_canceled/, shoot the same slot again. */
  private retakeShot(): void {
    const rec = this.record
    const sv = this.snap.session
    if (!rec || !sv || this.retakesUsed >= this.d.config.capture.maxRetakes) return
    const idx = sv.shotIndex - 1
    const fileName = rec.captures[idx]
    if (!fileName) return
    this.retakesUsed++
    try {
      const moved = this.d.store.cancelCapture(rec, fileName, this.retakesUsed)
      this.note('capture.retake', `${fileName} -> captures_canceled/${moved}`)
    } catch (e) {
      // keep going: the new shot overwrites the file; only the backup copy is lost
      this.d.logger.log('warn', 'capture.retake_backup_failed', { file: fileName, error: String(e) })
    }
    this.d.logger.log('info', 'capture.retake', { shot: sv.shotIndex, retake: this.retakesUsed })
    const captures = [...sv.captures]
    captures[idx] = ''
    this.shotAttempt = 0
    this.snap = { ...this.snap, session: { ...sv, captures, retakesLeft: this.d.config.capture.maxRetakes - this.retakesUsed } }
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
      // after a retake the file name is the same → add ?r=N so the UI does not show the cached old photo
      const url = this.d.urls.capture(rec.sessionId, fileName)
      captures[sv.shotIndex - 1] = this.retakesUsed > 0 ? `${url}?r=${this.retakesUsed}` : url
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
      Compose: t.compose,
      Print: t.print,
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
        const id = this.snap.selectedTemplateId ?? this.offered[0]!.id
        return this.chooseTemplate(id, 'timeout')
      }
      case 'Instruction':
        return this.beginShot(1)
      case 'Countdown':
        return this.enter('Shooting')
      case 'Shooting':
        return this.captureFailed('capture timeout')
      case 'Review':
        return this.acceptShot()
      case 'Compose':
        return this.fail('COMPOSE_TIMEOUT', 'ประกอบรูปไม่ทันเวลา', this.isPaid())
      case 'Print':
        return this.printFailed('print timeout')
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
    this.note('capture.done', `${this.record?.captures.length ?? 0} shots`)
    this.enter('Compose')
  }

  /** PRN-4: kiosk prints what was paid for; event prints config.event.printCopies (MODE-3 pending User). */
  private copiesForSession(): number {
    if (this.d.config.mode === 'event') return this.d.config.event.printCopies
    return this.record?.payment?.qty ?? 1
  }

  private async compose(epoch: number): Promise<void> {
    const rec = this.record
    const t = this.offered.find((x) => x.id === rec?.templateId)
    if (!rec || !t) return this.fail('NO_TEMPLATE', 'ไม่พบกรอบรูป', this.isPaid())
    const fileName = `${rec.sessionId}-print${t.size}.jpg`
    const outPath = join(this.d.store.sessionDir(rec), fileName)
    const photoPaths = t.photos.map((_, i) => join(this.d.store.captureDir(rec), rec.captures[i] ?? ''))
    try {
      const started = this.now()
      await this.d.compose(t, photoPaths, outPath)
      if (epoch !== this.epoch) return
      const copies = this.copiesForSession()
      rec.print = { file: fileName, copies, status: 'pending' }
      this.note('compose.ok', `${fileName} in ${this.now() - started} ms`)
      this.snap = { ...this.snap, session: { ...this.snap.session!, printUrl: this.d.urls.print(rec.sessionId, fileName), copies } }
      this.enter('Print')
    } catch (e) {
      if (epoch !== this.epoch) return
      this.fail('COMPOSE_FAILED', `ประกอบรูปไม่สำเร็จ: ${String(e)}`, this.isPaid())
    }
  }

  private async print(epoch: number): Promise<void> {
    const rec = this.record
    if (!rec?.print) return this.fail('NO_PRINT_FILE', 'ไม่มีไฟล์สำหรับพิมพ์', this.isPaid())
    try {
      await this.d.printer.print(join(this.d.store.sessionDir(rec), rec.print.file), rec.print.copies)
      if (epoch !== this.epoch) return
      rec.print.status = 'printed'
      this.note('print.ok', `${rec.print.copies} copies`)
      this.enter('ShowQR')
    } catch (e) {
      if (epoch !== this.epoch) return
      this.printFailed(String(e))
    }
  }

  /** PRN-8: keep the composed file + record so staff can reprint; customer sees the paid-error screen. */
  private printFailed(error: string): void {
    if (this.record?.print) this.record.print.status = 'failed'
    this.fail('PRINT_FAILED', `พิมพ์ไม่สำเร็จ: ${error}`, this.isPaid())
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
