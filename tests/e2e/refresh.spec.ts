import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page, request }) => {
  await request.post('/__reset')
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() => window.__faable.createClient())
  await page.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'user@example.com',
      otp: '123456'
    })
  )
})

test('refreshSession rotates the access and refresh tokens', async ({
  page
}) => {
  const before = await page.evaluate(() => window.__faable.getSession())
  expect(before?.access_token).toBeTruthy()

  const refreshResult = await page.evaluate(() =>
    window.__faable.refreshSession()
  )
  expect(refreshResult.error).toBeNull()

  const after = await page.evaluate(() => window.__faable.getSession())
  expect(after?.access_token).toBeTruthy()
  expect(after?.access_token).not.toBe(before?.access_token)
  expect(after?.refresh_token).not.toBe(before?.refresh_token)
})

test('refreshSession with a revoked refresh_token signs the user out', async ({
  page,
  request
}) => {
  // First successful refresh rotates the token; the *original* refresh_token
  // is now stale on the server side. Calling refreshSession again with stale
  // state forces a failure path through the mock.
  const original = await page.evaluate(() => window.__faable.getSession())
  expect(original).not.toBeNull()

  // Wipe the server's refresh_token bookkeeping so the next refresh fails.
  await request.post('/__reset')

  const result = await page.evaluate(() => window.__faable.refreshSession())
  expect(result.error).not.toBeNull()

  // SDK clears the session on a non-retryable refresh failure.
  const session = await page.evaluate(() => window.__faable.getSession())
  expect(session).toBeNull()
})

test('a session loaded from storage with an expired access_token gets refreshed transparently', async ({
  page,
  request
}) => {
  // Stash the current session, then mutate localStorage so its expires_at is
  // in the past. A fresh client should refresh on _initialize → _recoverAndRefresh.
  const stored = await page.evaluate(async () => {
    const session = await window.__faable.getSession()
    return session
  })
  expect(stored).not.toBeNull()

  // Reload the page with a tampered (expired) session in storage.
  await page.evaluate(session => {
    const expired = {
      ...session,
      expires_at: Math.floor(Date.now() / 1000) - 10
    }
    localStorage.setItem('faableauth-test-client', JSON.stringify(expired))
  }, stored)

  await page.reload()
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() => window.__faable.createClient())

  const refreshed = await page.waitForFunction(
    async () => {
      const s = await window.__faable.getSession()
      if (!s) return false
      // The mock issues a brand-new access_token; we just want it to differ
      // from the expired one we stashed.
      return s.access_token
    },
    null,
    { timeout: 5_000 }
  )
  const newToken = await refreshed.jsonValue()
  expect(newToken).toBeTruthy()
  expect(newToken).not.toBe(stored?.access_token)

  // The persisted session now has a fresh, non-expired expires_at.
  const persisted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('faableauth-test-client') || 'null')
  )
  expect(persisted.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))

  // Avoid `unused` lint on request param even though we use it via fixture
  void request
})
