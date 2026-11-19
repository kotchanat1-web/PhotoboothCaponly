import type { Snapshot } from '../../../shared/types'
import { t } from '../strings'
import { send, TimeoutBadge } from './common'

export function Idle({ s }: { s: Snapshot }) {
  return (
    <div className="screen attract" onClick={() => send({ type: 'TOUCH' })}>
      <h1 className="huge">📸 Photobooth</h1>
      <h2>{t.touchToStart}</h2>
      <div className="mode-tag">{s.mode === 'kiosk' ? 'KIOSK' : 'EVENT'}</div>
    </div>
  )
}

export function CheckDevices() {
  return (
    <div className="screen">
      <h1>{t.checking}</h1>
    </div>
  )
}

export function DeviceError({ s }: { s: Snapshot }) {
  return (
    <div className="screen">
      <h1>{t.deviceError}</h1>
      <h2>{t.contactStaff}</h2>
      <code>{s.error?.code}</code>
      <TimeoutBadge deadline={s.deadline} />
    </div>
  )
}

export function ErrorScreen({ s }: { s: Snapshot }) {
  return (
    <div className="screen">
      <h1>ขออภัย เกิดข้อผิดพลาด</h1>
      <h2>{t.contactStaff}</h2>
      {s.error?.paid && <p className="notice">{t.paidNotice}</p>}
      <code>
        {s.error?.code} · session {s.session?.sessionId ?? '-'}
      </code>
      <TimeoutBadge deadline={s.deadline} />
    </div>
  )
}

export function ShowQR({ s }: { s: Snapshot }) {
  const sv = s.session
  return (
    <div className="screen">
      <h1>{t.done}</h1>
      <div className="thumbs">
        {sv?.captures.map((c, i) => <img key={i} className="done-thumb" src={c} alt="" />)}
      </div>
      <div className="qrbox">
        <div className="mockqr">{t.scanToDownload}</div>
      </div>
      <button className="big" onClick={() => send({ type: 'FINISH' })}>
        {t.finish}
      </button>
      <TimeoutBadge deadline={s.deadline} />
    </div>
  )
}
