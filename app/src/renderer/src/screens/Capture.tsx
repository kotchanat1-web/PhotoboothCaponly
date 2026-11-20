import type { Snapshot } from '../../../shared/types'
import { LiveView } from '../liveview'
import { t } from '../strings'
import { send, useRemaining } from './common'

export function Instruction({ s }: { s: Snapshot }) {
  const r = useRemaining(s.deadline)
  return (
    <div className="screen" onClick={() => send({ type: 'START_CAPTURE' })}>
      <h1 className="huge">{t.ready}</h1>
      <h2>{t.smile}</h2>
      <button className="big">
        {t.start} ({r})
      </button>
    </div>
  )
}

/** Countdown → Shooting → Review share one live view so the camera stream is not restarted between states. */
export function CaptureStage({ s }: { s: Snapshot }) {
  const sv = s.session!
  const r = useRemaining(s.deadline)
  const last = sv.captures[sv.shotIndex - 1]
  return (
    <div className="capture">
      <LiveView cfg={s.liveView} />
      <div className="shot-counter">
        {t.shot} {sv.shotIndex}/{sv.shotsTotal}
      </div>
      {s.state === 'Countdown' && <div className="countdown">{r}</div>}
      {s.state === 'Shooting' && <div className="flash" />}
      {s.state === 'Review' && last && <img className="review" src={last} alt="" />}
      {s.state === 'Review' && (
        <div className="review-actions">
          {sv.retakesLeft > 0 && (
            <button className="big secondary" onClick={() => send({ type: 'RETAKE' })}>
              {t.retake} ({t.retakesLeft} {sv.retakesLeft})
            </button>
          )}
          <button className="big" onClick={() => send({ type: 'ACCEPT_SHOT' })}>
            {sv.shotIndex < sv.shotsTotal ? t.useThisPhoto : t.useThisPhotoLast} ({r})
          </button>
        </div>
      )}
    </div>
  )
}
