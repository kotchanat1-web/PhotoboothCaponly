import { useEffect, useState } from 'react'
import type { UiEvent } from '../../../shared/types'
import { t } from '../strings'

export const send = (ev: UiEvent) => window.booth.send(ev)

/** UI-3: visible countdown to the state's timeout. */
export function useRemaining(deadline: number | null): number | null {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (deadline === null) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [deadline])
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000))
}

export function TimeoutBadge({ deadline, label = t.backToStartIn }: { deadline: number | null; label?: string }) {
  const r = useRemaining(deadline)
  if (r === null) return null
  return (
    <div className="timeout">
      {label} {r} {t.sec}
    </div>
  )
}

export function formatMoney(n: number, currency: string): string {
  return currency === 'THB' ? `${n.toLocaleString('th-TH')} ${t.baht}` : `${n} ${currency}`
}
