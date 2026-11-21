import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // test-only values (not real keys); Omise is mocked in the tests
          bindings: {
            TEST_MIGRATIONS: migrations,
            OMISE_API_BASE: 'https://omise.test',
            OMISE_SECRET_KEY: 'skey_test_unit',
            OMISE_WEBHOOK_SECRET: btoa('unit-test-webhook-secret')
          }
        }
      })
    ],
    test: { setupFiles: ['./test/setup.ts'] }
  }
})
