import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request, page }) => {
  await request.post('/__reset')
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
})

test('signInWithPasswordless acknowledges the request', async ({ page }) => {
  await page.evaluate(() => window.__faable.createClient())
  const result = await page.evaluate(() =>
    window.__faable.signInWithPasswordless({
      email: 'user@example.com',
      type: 'code'
    })
  )
  expect(result.error).toBeNull()
  expect(result.data).toMatchObject({ email: 'user@example.com', sent: true })
})

test('signInWithOtp accepts a valid OTP and persists the session', async ({
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
  expect(result.data.session).not.toBeNull()
  expect(result.data.user?.email).toBe('user@example.com')

  const session = await page.evaluate(() => window.__faable.getSession())
  expect(session?.access_token).toMatch(/^at_/)
})

test('signInWithOtp forwards the configured audience to /oauth/token', async ({
  page,
  request
}) => {
  const audience = 'https://api.example.com'
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })

  await page.evaluate(
    aud => window.__faable.createClient({ audience: aud }),
    audience
  )
  const result = await page.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'user@example.com',
      otp: '123456'
    })
  )
  expect(result.error).toBeNull()

  const serverState = await request.get('/__state').then(r => r.json())
  const otpCall = serverState.audiences.token.find(
    (t: { grant_type: string }) =>
      t.grant_type === 'http://auth0.com/oauth/grant-type/passwordless/otp'
  )
  expect(otpCall?.audience).toBe(audience)
})

test('signInWithOtp per-call audience overrides the configured default', async ({
  page,
  request
}) => {
  const configAudience = 'https://api.example.com'
  const overrideAudience = 'https://api.other.com'
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })

  await page.evaluate(
    aud => window.__faable.createClient({ audience: aud }),
    configAudience
  )
  const result = await page.evaluate(
    aud =>
      window.__client.signInWithOtp({
        username: 'user@example.com',
        otp: '123456',
        audience: aud
      }),
    overrideAudience
  )
  expect(result.error).toBeNull()

  const serverState = await request.get('/__state').then(r => r.json())
  const otpCall = serverState.audiences.token.find(
    (t: { grant_type: string }) =>
      t.grant_type === 'http://auth0.com/oauth/grant-type/passwordless/otp'
  )
  expect(otpCall?.audience).toBe(overrideAudience)
})

test('signInWithOtp rejects a wrong OTP', async ({ page, request }) => {
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })

  await page.evaluate(() => window.__faable.createClient())
  const result = await page.evaluate(() =>
    window.__faable.signInWithOtp({
      username: 'user@example.com',
      otp: 'wrong'
    })
  )

  expect(result.error).not.toBeNull()
  expect(result.data.session).toBeNull()
})
