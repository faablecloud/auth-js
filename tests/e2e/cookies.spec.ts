import { expect, test } from '@playwright/test'

const STORAGE_KEY = 'faableauth-test-client'

test.beforeEach(async ({ request, context }) => {
  await request.post('/__reset')
  await request.post('/__seed/otp', {
    data: { username: 'cookie@example.com', otp: '654321' }
  })
  await context.clearCookies()
})

test('signing in with cookie storage persists the session in document.cookie', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() =>
    window.__faable.createClient({
      cookieOptions: { path: '/', sameSite: 'Lax' }
    })
  )

  const signIn = await page.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'cookie@example.com',
      otp: '654321'
    })
  )
  expect(signIn.error).toBeNull()

  // The session must round-trip through document.cookie, not localStorage.
  const cookieSession = await page.evaluate(key => {
    const cookies = document.cookie
      .split(';')
      .map(c => c.trim())
      .find(c => c.startsWith(encodeURIComponent(key) + '='))
    if (!cookies) return null
    const value = cookies.slice(cookies.indexOf('=') + 1)
    return JSON.parse(decodeURIComponent(value))
  }, STORAGE_KEY)

  expect(cookieSession?.user?.email).toBe('cookie@example.com')
  expect(cookieSession?.access_token).toMatch(/^at_/)

  // And localStorage should be untouched.
  const inLocalStorage = await page.evaluate(
    key => localStorage.getItem(key),
    STORAGE_KEY
  )
  expect(inLocalStorage).toBeNull()
})

test('a fresh client with cookieOptions recovers the session across reloads', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() =>
    window.__faable.createClient({
      cookieOptions: { path: '/', sameSite: 'Lax' }
    })
  )
  await page.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'cookie@example.com',
      otp: '654321'
    })
  )

  // New page navigation simulates an SSR client coming back. The same
  // cookieOptions must read the cookie back.
  await page.reload()
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() =>
    window.__faable.createClient({
      cookieOptions: { path: '/', sameSite: 'Lax' }
    })
  )

  const recovered = await page.evaluate(() => window.__faable.getSession())
  expect(recovered?.user?.email).toBe('cookie@example.com')
})

test('signOut clears the cookie', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() =>
    window.__faable.createClient({
      cookieOptions: { path: '/', sameSite: 'Lax' }
    })
  )
  await page.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'cookie@example.com',
      otp: '654321'
    })
  )

  await page.evaluate(() => window.__faable.signOut())

  const cookiePresent = await page.evaluate(key => {
    return document.cookie
      .split(';')
      .some(c => c.trim().startsWith(encodeURIComponent(key) + '='))
  }, STORAGE_KEY)
  expect(cookiePresent).toBe(false)
})

test('signOut() navigates top-level to /logout to clear the SSO cookie', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() =>
    window.__faable.createClient({
      cookieOptions: { path: '/', sameSite: 'Lax' }
    })
  )
  await page.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'cookie@example.com',
      otp: '654321'
    })
  )

  // Default (global) signOut must be a real navigation to /logout — the only
  // way to clear the auth server's SSO cookie. Don't return the promise: it
  // never resolves on the redirect path (the page is unloading).
  await Promise.all([
    page.waitForURL(/\/logout\?/),
    page.evaluate(() => {
      window.__client.signOut()
    })
  ])

  const url = new URL(page.url())
  expect(url.pathname).toBe('/logout')
  expect(url.searchParams.get('client_id')).toBe('test-client')
})

test('signOut({ redirect: false }) clears the cookie without navigating', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() =>
    window.__faable.createClient({
      cookieOptions: { path: '/', sameSite: 'Lax' }
    })
  )
  await page.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'cookie@example.com',
      otp: '654321'
    })
  )

  await page.evaluate(() => window.__client.signOut({ redirect: false }))

  expect(new URL(page.url()).pathname).toBe('/')
  const cookiePresent = await page.evaluate(key => {
    return document.cookie
      .split(';')
      .some(c => c.trim().startsWith(encodeURIComponent(key) + '='))
  }, STORAGE_KEY)
  expect(cookiePresent).toBe(false)
})

test('values containing ";" survive the cookie round-trip', async ({
  page,
  request
}) => {
  // Stage a custom OTP so the response carries a user with a tricky email.
  await request.post('/__reset')
  await request.post('/__seed/otp', {
    data: { username: 'weird;value@example.com', otp: '987654' }
  })

  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() =>
    window.__faable.createClient({
      cookieOptions: { path: '/', sameSite: 'Lax' }
    })
  )

  const result = await page.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'weird;value@example.com',
      otp: '987654'
    })
  )
  expect(result.error).toBeNull()

  const session = await page.evaluate(() => window.__faable.getSession())
  expect(session?.user?.email).toBe('weird;value@example.com')
})
