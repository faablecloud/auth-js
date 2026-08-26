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

// Regression: `_sessionResponse` used to destructure `data` alone and return a
// hardcoded `error: null`, which made the `if (error)` branch in every caller
// dead code. Every failed sign-in — a rejected code, a rate limit, an action
// deny — came out as the generic AuthInvalidTokenResponseError, whose message
// is "Auth session or user missing". A user staring at that has no way to know
// their code was simply wrong, and the assertion below is the one this file was
// missing: the old test checked that SOME error came back, which the generic
// one satisfied.
test('signInWithOtp surfaces the server reason for a rejected code', async ({
  page,
  request
}) => {
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })

  await page.evaluate(() => window.__faable.createClient())
  // Read the fields INSIDE the page: Playwright serializes an Error across the
  // evaluate boundary down to name/message and drops `status`.
  const result = await page.evaluate(async () => {
    const r = await window.__faable.signInWithOtp({
      username: 'user@example.com',
      otp: 'wrong'
    })
    return {
      session: r.data.session,
      message: r.error?.message,
      status: r.error?.status
    }
  })

  expect(result.session).toBeNull()
  expect(result.message).toBe('Invalid or expired OTP')
  expect(result.message).not.toBe('Auth session or user missing')
  expect(result.status).toBe(400)
})

// The message has to survive verbatim whatever the server says, not just the
// one string this mock happens to use for a bad code: the refusals that matter
// most in production are the ones nobody hardcoded here (an action deny, a
// per-target rate limit).
test('signInWithOtp passes an arbitrary server refusal through untouched', async ({
  page,
  request
}) => {
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })
  await request.post('/__seed/token_failure', {
    // The real shape for an action deny: an OAuth code plus the human text in
    // `error_description`. The description is what the user must read, not the
    // machine code next to it.
    data: {
      status: 429,
      body: {
        error: 'access_denied',
        error_description: 'Rate limit exceeded'
      }
    }
  })

  await page.evaluate(() => window.__faable.createClient())
  const result = await page.evaluate(async () => {
    const r = await window.__faable.signInWithOtp({
      username: 'user@example.com',
      otp: '123456'
    })
    return {
      session: r.data.session,
      message: r.error?.message,
      status: r.error?.status
    }
  })

  expect(result.session).toBeNull()
  expect(result.message).toBe('Rate limit exceeded')
  expect(result.status).toBe(429)
})

// An error object, not a bare string: the dashboard renders `error.message`,
// and a string would render as `undefined` — the same blank-stare failure in a
// different disguise.
test('a failed signInWithOtp returns a real AuthError', async ({
  page,
  request
}) => {
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })

  await page.evaluate(() => window.__faable.createClient())
  const shape = await page.evaluate(async () => {
    const r = await window.__faable.signInWithOtp({
      username: 'user@example.com',
      otp: 'wrong'
    })
    return {
      isObject: typeof r.error === 'object' && r.error !== null,
      name: r.error?.name,
      hasMessage: typeof r.error?.message === 'string'
    }
  })

  expect(shape.isObject).toBe(true)
  expect(shape.hasMessage).toBe(true)
  expect(shape.name).toBe('AuthApiError')
})
