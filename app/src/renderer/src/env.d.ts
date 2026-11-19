import type { BoothApi } from '../../preload'

declare global {
  interface Window {
    booth: BoothApi
  }
}

export {}
