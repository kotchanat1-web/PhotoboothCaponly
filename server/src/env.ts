import type { BoothHub } from './hub'

/** Bindings + vars (wrangler.jsonc) + secrets (wrangler secret put / .dev.vars). */
export interface AppEnv {
  DB: D1Database
  BOOTH_HUB: DurableObjectNamespace<BoothHub>
  OMISE_API_BASE: string
  /** how long a PromptPay QR stays payable (Omise expires_at) */
  QR_EXPIRY_SEC: string
  /** after expiry, keep checking Omise this long for a late payment before giving up */
  LATE_GRACE_SEC: string
  /** secret — Omise secret key (skey_test_… / skey_…) */
  OMISE_SECRET_KEY?: string
  /** secret — Omise webhook signing secret (Base64) */
  OMISE_WEBHOOK_SECRET?: string
}
