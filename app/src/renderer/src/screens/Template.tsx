import type { Snapshot } from '../../../shared/types'
import { t } from '../strings'
import { send, TimeoutBadge } from './common'

/** TPL-1 (demo): big preview + thumbnail strip. Real template.xml import comes in M1-2. */
export function SelectTemplate({ s }: { s: Snapshot }) {
  const selected = s.templates.find((x) => x.id === s.selectedTemplateId) ?? s.templates[0]!
  return (
    <div className="screen">
      <h1>{t.chooseTemplate}</h1>
      <div className={`tpl-preview tpl-${selected.size}`} style={{ background: selected.color }}>
        {Array.from({ length: selected.shots }, (_, i) => (
          <div key={i} className="slot">
            {i + 1}
          </div>
        ))}
      </div>
      <div className="tpl-name">
        {selected.name} · {selected.shots} {t.shots}
      </div>
      <div className="thumbs">
        {s.templates.map((tp) => (
          <button
            key={tp.id}
            className={`thumb ${tp.id === selected.id ? 'active' : ''}`}
            style={{ background: tp.color }}
            onClick={() => send({ type: 'HIGHLIGHT_TEMPLATE', id: tp.id })}
          >
            {tp.size} · {tp.shots}
          </button>
        ))}
      </div>
      <button className="big" onClick={() => send({ type: 'SELECT_TEMPLATE', id: selected.id })}>
        {t.start}
      </button>
      <TimeoutBadge deadline={s.deadline} label={s.mode === 'kiosk' ? 'เริ่มอัตโนมัติใน' : undefined} />
    </div>
  )
}
