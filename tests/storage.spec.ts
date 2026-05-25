import { expect, test } from '@playwright/test'

test.describe('Auth-js Storage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`http://localhost:8082/examples/test_storage.html`)
    // Wait for scripts to load and setup functions to be defined
    await page.waitForFunction(
      () => typeof window.setupLocalStorage === 'function'
    )
  })

  test('should persist session in localStorage', async ({ page }) => {
    const storageKey = 'faableauth-test-client-id'
    const session = {
      access_token: 'test-token',
      refresh_token: 'test-refresh',
      expires_in: 3600,
      token_type: 'bearer',
      user: { sub: '123' },
      expires_at: Math.floor(Date.now() / 1000) + 3600
    }

    // Set manually in localStorage
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, JSON.stringify(value))
      },
      { key: storageKey, value: session }
    )

    // Initialize client and check if recovered
    await page.evaluate(() => window.setupLocalStorage())
    const recoveredSession = await page.evaluate(() => window.getSession())
    expect(recoveredSession.access_token).toBe('test-token')
  })

  test('should persist session in cookieStorage', async ({ page }) => {
    const storageKey = 'faableauth-test-client-id'
    const session = {
      access_token: 'cookie-token',
      refresh_token: 'cookie-refresh',
      expires_in: 3600,
      token_type: 'bearer',
      user: { sub: '456' },
      expires_at: Math.floor(Date.now() / 1000) + 3600
    }

    // Set manually in cookies
    const cookieValue = encodeURIComponent(JSON.stringify(session))
    await page.context().addCookies([
      {
        name: storageKey,
        value: cookieValue,
        url: 'http://localhost:8082'
      }
    ])

    // Initialize client and check if recovered
    await page.evaluate(() => window.setupCookieStorage())
    const recoveredSession = await page.evaluate(() => window.getSession())
    expect(recoveredSession.access_token).toBe('cookie-token')
  })
})
