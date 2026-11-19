// Shared types between main (core) and renderer (UI).
// State names follow PRD v1.2 section 5 (state machine).

export type BoothMode = 'kiosk' | 'event'

export type StateName =
  | 'Idle'
  | 'CheckDevices'
  | 'DeviceError'
  | 'SelectPayment'
  | 'SelectQty'
  | 'CreatingCharge'
  | 'WaitPayment'
  | 'ConfirmCancel'
  | 'SelectTemplate'
  | 'Instruction'
  | 'Countdown'
  | 'Shooting'
  | 'Review'
  | 'Compose'
  | 'Print'
  | 'ShowQR'
  | 'Error'

export interface TemplateInfo {
  id: string
  name: string
  size: '4x6' | '2x6'
  shots: number
  /** booth:// URL of the old system preview.png, if any */
  previewUrl: string | null
}

export interface PaymentView {
  provider: string
  chargeId: string
  qty: number
  amount: number
  currency: string
  qrPayload: string
  expiresAt: number
}

export interface SessionView {
  sessionId: string
  templateId: string | null
  shotsTotal: number
  /** 1-based index of the current shot */
  shotIndex: number
  /** booth:// URLs of captured shots */
  captures: string[]
  /** booth:// URL of the composed print image (after Compose) */
  printUrl: string | null
  /** number of prints for this session (PRN-4) */
  copies: number
}

export interface ErrorView {
  code: string
  message: string
  /** true when the customer already paid — staff must compensate (BR-02 draft) */
  paid: boolean
}

export interface Snapshot {
  state: StateName
  mode: BoothMode
  /** epoch ms when the current state times out, or null */
  deadline: number | null
  prices: Record<string, number>
  currency: string
  templates: TemplateInfo[]
  selectedTemplateId: string | null
  session: SessionView | null
  payment: PaymentView | null
  error: ErrorView | null
  liveView: {
    source: 'mock' | 'webcam'
    mirror: boolean
    /** camera mounting rotation, applied to webcam frames (display + capture) */
    rotation: 0 | 90 | 180 | 270
    webcam: { deviceLabel: string; idealWidth: number; idealHeight: number }
  }
  /** true when the payment provider is the mock (shows dev-only "simulate paid") */
  devPayment: boolean
}

export type UiEvent =
  | { type: 'TOUCH' }
  | { type: 'ACTIVITY' }
  | { type: 'BACK' }
  | { type: 'CHOOSE_PROMPTPAY' }
  | { type: 'SELECT_QTY'; qty: number }
  | { type: 'CANCEL_REQUEST' }
  | { type: 'CONFIRM_CANCEL' }
  | { type: 'HIGHLIGHT_TEMPLATE'; id: string }
  | { type: 'SELECT_TEMPLATE'; id: string }
  | { type: 'START_CAPTURE' }
  | { type: 'FINISH' }
  | { type: 'DEV_SIMULATE_PAID' }

/** Requests main sends to the renderer (camera frames come from the live view in the UI). */
export type RpcMethod = 'camera:probe' | 'camera:grab'
