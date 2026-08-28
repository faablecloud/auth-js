import { expect, test } from '@playwright/test'

// The journey behind arch/auth/link-mode-session-ticket.md, in a real
// browser against the built bundle: sign in with a passwordless OTP (a direct
// grant — tokens, but no cookie on the auth host), then "Connect GitHub".
// The SDK must trade the access token for a link ticket and put it on the
// /authorize?link=true URL; without it the server has no session to link to
// and answers login_required.

test.beforeEach(async ({ request, page }) => {
  await request.post('/__reset')
  await page.goto('/')
  await page.waitForFunction(() => typeof window.__faable !== 'undefined')
})

const signInWithOtp = async (page: any, request: any) => {
  await request.post('/__seed/otp', {
    data: { username: 'otp-user@example.com', otp: '123456' }
  })
  await page.evaluate(() => window.__faable.createClient())
  const result = await page.evaluate(() =>
    window.__faable.signInWithOtp({
      username: 'otp-user@example.com',
      otp: '123456'
    })
  )
  expect(result.error).toBeNull()
  const session = await page.evaluate(() => window.__faable.getSession())
  expect(session?.access_token).toMatch(/^at_/)
  return session
}

test("after an OTP sign-in, Connect GitHub carries a link ticket minted with that session's bearer", async ({
  page,
  request
}) => {
  const session = await signInWithOtp(page, request)

  const { url, error } = await page.evaluate(() =>
    window.__faable.linkOauthConnection({
      connection_id: 'connection_github',
      redirectTo: window.location.origin + '/return'
    })
  )
  expect(error).toBeNull()
  const authorize = new URL(url)
  expect(authorize.pathname).toBe('/authorize')
  expect(authorize.searchParams.get('link')).toBe('true')
  expect(authorize.searchParams.get('connection_id')).toBe('connection_github')
  // Link mode must never carry prompt=login (it would destroy the session).
  expect(authorize.searchParams.get('prompt')).toBeNull()

  const ticket = authorize.searchParams.get('link_ticket')
  expect(ticket).toMatch(/^lt_/)

  // The ticket on the URL is the one the server minted for THIS bearer.
  const state = await (await request.get('/__state')).json()
  expect(state.linkTickets).toEqual([
    { bearer: session.access_token, link_ticket: ticket }
  ])
})

test('without a session, Connect GitHub sends no ticket and never calls the endpoint', async ({
  page,
  request
}) => {
  await page.evaluate(() => window.__faable.createClient())

  const { url, error } = await page.evaluate(() =>
    window.__faable.linkOauthConnection({ connection_id: 'connection_github' })
  )
  expect(error).toBeNull()
  expect(new URL(url).searchParams.get('link')).toBe('true')
  expect(new URL(url).searchParams.get('link_ticket')).toBeNull()

  const state = await (await request.get('/__state')).json()
  expect(state.linkTickets).toEqual([])
})

test('a server without the endpoint (404) degrades to a ticket-less link, not an error', async ({
  page,
  request
}) => {
  await signInWithOtp(page, request)
  await request.post('/__seed/link_ticket_failure', {
    data: {
      status: 404,
      body: { message: 'Route POST:/oauth/link_ticket not found' }
    }
  })

  const { url, error } = await page.evaluate(() =>
    window.__faable.linkOauthConnection({ connection_id: 'connection_github' })
  )
  expect(error).toBeNull()
  expect(new URL(url).searchParams.get('link')).toBe('true')
  expect(new URL(url).searchParams.get('link_ticket')).toBeNull()

  // The session survives the failed mint — nothing about it was touched.
  const session = await page.evaluate(() => window.__faable.getSession())
  expect(session?.access_token).toMatch(/^at_/)
})
