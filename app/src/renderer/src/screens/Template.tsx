import type { Snapshot } from '../../../shared/types'
import { t } from '../strings'
import { send, TimeoutBadge } from './common'

/** TPL-1: big preview + scrollable thumbnail strip, using each template's preview.png. */
export function SelectTemplate({ s }: { s: Snapshot }) {
  const selected = s.templates.find((x) => x.id === s.selectedTemplateId) ?? s.templates[0]!
  return (
    <div className="screen">
      <h1>{t.chooseTemplate}</h1>
      <div className={`tpl-preview tpl-${selected.size}`}>
        {selected.previewUrl ? <img src={selected.previewUrl} alt="" /> : <div className="slot">{selected.name}</div>}
      </div>
      <div className="tpl-name">
        {selected.name} · {selected.shots} {t.shots}
      </div>
      <div className="thumbs">
        {s.templates.map((tp) => (
          <button
            key={tp.id}
            data-id={tp.id}
            className={`thumb tpl-${tp.size} ${tp.id === selected.id ? 'active' : ''}`}
            onClick={() => send({ type: 'HIGHLIGHT_TEMPLATE', id: tp.id })}
          >
            {tp.previewUrl ? <img src={tp.previewUrl} alt="" loading="lazy" /> : tp.name}
          </button>
        ))}
      </div>
      <button className="big" onClick={() => send({ type: 'SELECT_TEMPLATE', id: selected.id })}>
        {t.start}
      </button>
      <TimeoutBadge deadline={s.deadline} label={s.mode === 'kiosk' ? t.autoStartIn : undefined} />
    </div>
  )
}
