import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e/**/*.spec.ts', 'storage.spec.ts'],
  // Mock server holds a single shared in-memory state; tests reset it in
  // beforeEach. Running serially is the simplest way to keep that safe.
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:8082'
  },
  webServer: [
    {
      command: 'node tests/e2e/mock-server.mjs',
      url: 'http://localhost:8082/__state',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PORT: '8082' }
    }
  ]
})
