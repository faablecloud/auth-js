import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.post('/__reset')
  await request.post('/__seed/otp', {
    data: { username: 'user@example.com', otp: '123456' }
  })
})

test('a SIGNED_IN in one tab is delivered to a listener in another tab', async ({
  browser,
  context
}) => {
  // Two tabs sharing the same browser context (same origin, same storage).
  const tabA = await context.newPage()
  const tabB = await context.newPage()

  await tabA.goto('/')
  await tabB.goto('/')
  await Promise.all([
    tabA.waitForFunction(() => typeof window.__faable !== 'undefined'),
    tabB.waitForFunction(() => typeof window.__faable !== 'undefined')
  ])

  await tabA.evaluate(() => window.__faable.createClient())
  await tabB.evaluate(() => window.__faable.createClient())

  // Subscribe in tab B BEFORE signing in elsewhere.
  await tabB.evaluate(() => window.__faable.subscribeEvents())

  // Sign in on tab A.
  const result = await tabA.evaluate(() =>
    window.__client.signInWithOtp({
      username: 'user@example.com',
      otp: '123456'
    })
  )
  expect(result.error).toBeNull()

  // Wait until tab B has observed a SIGNED_IN event from the cross-tab
  // BroadcastChannel post.
  await tabB.waitForFunction(
    () =>
      window.__faable.events.some(e => e.event === 'SIGNED_IN' && e.hasSession),
    null,
    { timeout: 5_000 }
  )

  const events = await tabB.evaluate(() => window.__faable.events)
  expect(events).toContainEqual({ event: 'SIGNED_IN', hasSession: true })

  await Promise.all([tabA.close(), tabB.close()])
  // keep references used so eslint doesn't trip on unused-arg
  void browser
})
