import type { Snapshot } from '../../../shared/types'
import { t } from '../strings'
import { formatMoney, send, TimeoutBadge, useRemaining } from './common'

export function SelectPayment({ s }: { s: Snapshot }) {
  return (
    <div className="screen">
      <h1>{t.choosePayment}</h1>
      <div className="row">
        <button className="big" onClick={() => send({ type: 'CHOOSE_PROMPTPAY' })}>
          {t.promptpay}
        </button>
        <button className="big" disabled title="PAY-4 — M2">
          {t.coupon} {t.comingSoon}
        </button>
      </div>
      <button className="link" onClick={() => send({ type: 'BACK' })}>
        {t.back}
      </button>
      <TimeoutBadge deadline={s.deadline} />
    </div>
  )
}

export function SelectQty({ s }: { s: Snapshot }) {
  const qtys = Object.keys(s.prices)
    .map(Number)
    .sort((a, b) => a - b)
  return (
    <div className="screen">
      <h1>{t.chooseQty}</h1>
      <div className="row wrap">
        {qtys.map((q) => (
          <button key={q} className="card" onClick={() => send({ type: 'SELECT_QTY', qty: q })}>
            <div className="qty">
              {q} {t.sheets}
            </div>
            <div className="price">{formatMoney(s.prices[String(q)]!, s.currency)}</div>
          </button>
        ))}
      </div>
      <button className="link" onClick={() => send({ type: 'BACK' })}>
        {t.back}
      </button>
      <TimeoutBadge deadline={s.deadline} />
    </div>
  )
}

export function CreatingCharge() {
  return (
    <div className="screen">
      <h1>{t.creatingQr}</h1>
    </div>
  )
}

function QrBox({ s }: { s: Snapshot }) {
  const p = s.payment!
  return (
    <div className="qrbox">
      <div className="mockqr">{t.mockQr}</div>
      <code>{p.qrPayload}</code>
    </div>
  )
}

export function WaitPayment({ s }: { s: Snapshot }) {
  const p = s.payment!
  const remaining = useRemaining(p.expiresAt)
  return (
    <div className="screen">
      <h1>{t.scanToPay}</h1>
      <div className="price big-price">{formatMoney(p.amount, p.currency)}</div>
      <div>
        {p.qty} {t.sheets}
      </div>
      <QrBox s={s} />
      <div className="timeout">
        {t.qrExpiresIn} {remaining} {t.sec}
      </div>
      <div className="row">
        <button onClick={() => send({ type: 'CANCEL_REQUEST' })}>{t.cancel}</button>
        {s.devPayment && (
          <button className="dev" onClick={() => send({ type: 'DEV_SIMULATE_PAID' })}>
            {t.devPaid}
          </button>
        )}
      </div>
    </div>
  )
}

export function ConfirmCancel({ s }: { s: Snapshot }) {
  return (
    <div className="screen">
      <h1>{t.confirmCancelTitle}</h1>
      <div className="row">
        <button className="big" onClick={() => send({ type: 'BACK' })}>
          {t.confirmCancelNo}
        </button>
        <button className="big danger" onClick={() => send({ type: 'CONFIRM_CANCEL' })}>
          {t.confirmCancelYes}
        </button>
      </div>
      {s.devPayment && (
        <button className="dev" onClick={() => send({ type: 'DEV_SIMULATE_PAID' })}>
          {t.devPaid}
        </button>
      )}
      <TimeoutBadge deadline={s.deadline} label={t.qrExpiresIn} />
    </div>
  )
}
