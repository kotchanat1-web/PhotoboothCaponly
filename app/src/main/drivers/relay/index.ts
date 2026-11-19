import type { Logger } from '../../logger'

// HW-1: relay board. Protocol from PRD archive section 2.4:
//   33 3C 00 00 00 <CH> <STATE> <CHECKSUM>, STATE 01=ON 02=OFF, CHECKSUM = sum of previous bytes & 0xFF
// Serial driver comes in M1-4; M1-1 only builds frames and logs them (mock).

export function buildRelayFrame(channel: number, on: boolean): Buffer {
  if (!Number.isInteger(channel) || channel < 1 || channel > 255) throw new Error(`invalid relay channel ${channel}`)
  const bytes = [0x33, 0x3c, 0x00, 0x00, 0x00, channel, on ? 0x01 : 0x02]
  const checksum = bytes.reduce((a, b) => a + b, 0) & 0xff
  return Buffer.from([...bytes, checksum])
}

export interface RelayDriver {
  readonly id: string
  set(channel: number, on: boolean): Promise<void>
}

export class MockRelay implements RelayDriver {
  readonly id = 'mock'
  readonly state = new Map<number, boolean>()
  constructor(private logger: Logger) {}

  async set(channel: number, on: boolean): Promise<void> {
    const frame = buildRelayFrame(channel, on)
    this.state.set(channel, on)
    this.logger.log('debug', 'relay.set', { channel, on, frame: frame.toString('hex') })
  }
}

/** For event setups without a relay board (MODE-6, pending User confirmation). */
export class NoRelay implements RelayDriver {
  readonly id = 'none'
  async set(): Promise<void> {}
}
