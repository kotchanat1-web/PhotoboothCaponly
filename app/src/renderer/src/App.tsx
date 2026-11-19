import { useEffect, useState } from 'react'
import type { Snapshot } from '../../shared/types'
import { closeWebcam, grabFrame, probeWebcam, setCameraConfig } from './liveview'
import { CaptureStage, Instruction } from './screens/Capture'
import { send } from './screens/common'
import { ConfirmCancel, CreatingCharge, SelectPayment, SelectQty, WaitPayment } from './screens/Payment'
import { CheckDevices, Composing, DeviceError, ErrorScreen, Idle, Printing, ShowQR } from './screens/Status'
import { SelectTemplate } from './screens/Template'

window.booth.handleRpc('camera:grab', grabFrame)
window.booth.handleRpc('camera:probe', probeWebcam)

export function App() {
  const [s, setS] = useState<Snapshot | null>(null)

  useEffect(() => {
    const apply = (snap: Snapshot) => {
      setCameraConfig(snap.liveView)
      if (snap.state === 'Idle') closeWebcam() // don't keep the camera streaming between customers
      setS(snap)
    }
    const off = window.booth.onSnapshot(apply)
    void window.booth.getSnapshot().then(apply)
    return off
  }, [])

  if (!s) return null

  return (
    <div className="app" data-state={s.state} onPointerDown={() => send({ type: 'ACTIVITY' })}>
      {render(s)}
    </div>
  )
}

function render(s: Snapshot) {
  switch (s.state) {
    case 'Idle':
      return <Idle s={s} />
    case 'CheckDevices':
      return <CheckDevices />
    case 'DeviceError':
      return <DeviceError s={s} />
    case 'SelectPayment':
      return <SelectPayment s={s} />
    case 'SelectQty':
      return <SelectQty s={s} />
    case 'CreatingCharge':
      return <CreatingCharge />
    case 'WaitPayment':
      return <WaitPayment s={s} />
    case 'ConfirmCancel':
      return <ConfirmCancel s={s} />
    case 'SelectTemplate':
      return <SelectTemplate s={s} />
    case 'Instruction':
      return <Instruction s={s} />
    case 'Countdown':
    case 'Shooting':
    case 'Review':
      return <CaptureStage s={s} />
    case 'Compose':
      return <Composing />
    case 'Print':
      return <Printing s={s} />
    case 'ShowQR':
      return <ShowQR s={s} />
    case 'Error':
      return <ErrorScreen s={s} />
  }
}
