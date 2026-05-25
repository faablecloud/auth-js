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
