import { expect, test } from '@playwright/test'

// The "last used login method" hint: a confirmed login leaves a dedicated
// `<storageKey>-last-used` cookie behind, readable through
// getLastUsedLoginMethod() so login UIs can badge the matching button.

test.beforeEach(async ({ request, page }) => {
  await request.post('/__reset')
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
})

test('a completed PKCE login records the oauth method with its connection', async ({
  page
}) => {
  await page.evaluate(() => window.__faable.createClient())

  // Nothing recorded up-front, but starting the flow leaves a pending attempt.
  expect(
    await page.evaluate(() => window.__faable.getLastUsedLoginMethod())
  ).toBeNull()

  const authorizeUrl = await page.evaluate(async () => {
    const { data } = await window.__client.signInWithOauthConnection({
      connection: 'google',
      skipBrowserRedirect: true
    })
    return data.url
  })
  expect(
    await page.evaluate(() =>
      localStorage.getItem('faableauth-test-client-login-attempt')
    )
  ).toContain('"oauth"')

  // Round-trip through /authorize and the code exchange on the callback.
  await page.goto(authorizeUrl)
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() => window.__faable.createClient())
  await page.waitForFunction(
    async () => await window.__faable.getSession(),
    null,
    {
      timeout: 5_000
    }
  )

  const lastUsed = await page.evaluate(() =>
    window.__faable.getLastUsedLoginMethod()
  )
  expect(lastUsed).toMatchObject({ method: 'oauth', connection: 'google' })
  expect(typeof lastUsed.at).toBe('number')

  // The attempt was consumed and the record lives in a cookie, not storage.
  expect(
    await page.evaluate(() =>
      localStorage.getItem('faableauth-test-client-login-attempt')
    )
  ).toBeNull()
  expect(await page.evaluate(() => document.cookie)).toContain(
    'faableauth-test-client-last-used='
  )
})

test('a successful OTP exchange records the otp method in-page', async ({
  page,
  request
}) => {
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })

  await page.evaluate(() => window.__faable.createClient())
  const result = await page.evaluate(() =>
    window.__faable.signInWithOtp({
      username: 'user@example.com',
      otp: '123456'
    })
  )
  expect(result.error).toBeNull()

  const lastUsed = await page.evaluate(() =>
    window.__faable.getLastUsedLoginMethod()
  )
  expect(lastUsed).toMatchObject({ method: 'otp' })
})

test('a failed OTP exchange records nothing', async ({ page }) => {
  await page.evaluate(() => window.__faable.createClient())
  const result = await page.evaluate(() =>
    window.__faable.signInWithOtp({
      username: 'user@example.com',
      otp: '000000'
    })
  )
  expect(result.error).not.toBeNull()

  expect(
    await page.evaluate(() => window.__faable.getLastUsedLoginMethod())
  ).toBeNull()
})

test('the record survives signOut — that is the point of the hint', async ({
  page,
  request
}) => {
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })

  await page.evaluate(() => window.__faable.createClient())
  await page.evaluate(() =>
    window.__faable.signInWithOtp({
      username: 'user@example.com',
      otp: '123456'
    })
  )
  await page.evaluate(() => window.__faable.signOut())

  expect(await page.evaluate(() => window.__faable.getSession())).toBeNull()
  expect(
    await page.evaluate(() => window.__faable.getLastUsedLoginMethod())
  ).toMatchObject({ method: 'otp' })
})
