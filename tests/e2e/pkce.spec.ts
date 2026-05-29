import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.post('/__reset')
})

test('PKCE flow exchanges the authorization code and persists a session', async ({
  page
}) => {
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() => window.__faable.createClient())

  // Ask the SDK to build the /authorize URL (with a fresh code_verifier
  // stashed in storage) without redirecting the page yet.
  const authorizeUrl = await page.evaluate(async () => {
    const { data } = await window.__client.signInWithOauthConnection({
      connection: 'google',
      skipBrowserRedirect: true
    })
    return data.url
  })

  // Follow the OAuth round-trip: /authorize -> redirect back to the
  // redirect_uri with ?code=<generated>.
  await page.goto(authorizeUrl)

  // The fixture has reloaded. Re-create the client so it picks up the
  // ?code=... in the URL, exchanges it against the mock token endpoint and
  // persists the resulting session.
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() => window.__faable.createClient())

  const sessionData = await page
    .waitForFunction(async () => await window.__faable.getSession(), null, {
      timeout: 5_000
    })
    .then(handle => handle.jsonValue())

  expect(sessionData?.access_token).toMatch(/^at_/)
  expect(sessionData?.user?.email).toBe('pkce@example.com')

  // SDK strips the code from the URL after a successful exchange.
  expect(new URL(page.url()).searchParams.has('code')).toBe(false)
})

test('configured audience reaches /authorize and the code-exchange POST', async ({
  page,
  request
}) => {
  const audience = 'https://api.example.com'

  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(
    aud => window.__faable.createClient({ audience: aud }),
    audience
  )

  const authorizeUrl = await page.evaluate(async () => {
    const { data } = await window.__client.signInWithOauthConnection({
      connection: 'google',
      skipBrowserRedirect: true
    })
    return data.url
  })
  expect(new URL(authorizeUrl).searchParams.get('audience')).toBe(audience)

  await page.goto(authorizeUrl)
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(
    aud => window.__faable.createClient({ audience: aud }),
    audience
  )

  await page.waitForFunction(async () => await window.__faable.getSession(), null, {
    timeout: 5_000
  })

  const serverState = await request.get('/__state').then(r => r.json())
  expect(serverState.audiences.authorize).toContain(audience)
  const codeExchange = serverState.audiences.token.find(
    (t: { grant_type: string }) => t.grant_type === 'authorization_code'
  )
  expect(codeExchange?.audience).toBe(audience)
})

test('an authorization code with no stored verifier is rejected', async ({
  page,
  request
}) => {
  // Seed a code on the server but never call signInWithOauthConnection first,
  // so the SDK has no code_verifier in storage.
  await request.post('/__seed/pkce', {
    data: { code: 'stale-code', code_challenge: '' }
  })

  await page.goto('/?code=stale-code')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
  await page.evaluate(() => window.__faable.createClient())

  // Give the SDK a moment to attempt the exchange and fail.
  await page.waitForTimeout(200)
  const session = await page.evaluate(() => window.__faable.getSession())
  expect(session).toBeNull()
})
