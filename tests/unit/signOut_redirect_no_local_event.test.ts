import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { _get } from '../../src/lib/fetch'
import { windowHelpers } from '../../src/lib/helpers/window'
import type { SupportedStorage } from '../../src/lib/types'

// The non-redirect path GETs `/logout` through `_get`; keep it off the network.
vi.mock('../../src/lib/fetch', () => ({
  _get: vi.fn(async () => ({ data: null, error: null })),
  _post: vi.fn(async () => ({ data: null, error: null }))
}))

const mGet = _get as unknown as ReturnType<typeof vi.fn>

const inMemoryStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
}

const SESSION_KEY = 'faableauth-test-client'

// What the other tabs would receive. The real BroadcastChannel is replaced so
// the test owns both ends — and so no channel outlives the test.
const posted: unknown[] = []
class FakeBroadcastChannel {
  constructor(public name: string) {}
  addEventListener() {}
  postMessage(msg: unknown) {
    posted.push(msg)
  }
  close() {}
}

const seededClient = () => {
  const storage = inMemoryStorage()
  storage.setItem(
    SESSION_KEY,
    JSON.stringify({
      access_token: 'at_test',
      refresh_token: 'rt_test',
      id_token: 'eyJ.id.tok',
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user_test' }
    })
  )
  const auth = createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage
  })
  return { auth, storage }
}

beforeEach(() => {
  posted.length = 0
  mGet.mockReset()
  mGet.mockResolvedValue({ data: null, error: null })
  // `isBrowser()` is `typeof document !== 'undefined'`: the redirecting sign-out
  // exists only in a browser, so give it one.
  vi.stubGlobal('document', {})
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// The global sign-out of a browser is a top-level navigation to `/logout`.
// Until 3.2.0 it told this document's own listeners `SIGNED_OUT` right before
// navigating, and every auth guard that reacts to a null session answered with
// a navigation of its own (`router.push('/login')`), racing the real one.
// Chrome let the top-level navigation win. Safari on iOS did not (2026-10-31):
// `/logout` never ran, the SSO session survived, and the Back gesture later
// restored the signed-out page from the bfcache, frozen on its spinner.
describe('signOut({ scope: "global" }) with a redirect', () => {
  it('navigates to /logout without telling this document SIGNED_OUT', async () => {
    const { auth, storage } = seededClient()
    const redirect = vi
      .spyOn(windowHelpers, 'redirect')
      .mockImplementation(() => {})
    const events: string[] = []
    auth.onAuthStateChange(event => {
      events.push(event)
    })

    // Never resolves on this path: the navigation owns what happens next.
    void auth.signOut({
      scope: 'global',
      returnTo: 'https://app.example.com/bye'
    })

    await vi.waitFor(() => expect(redirect).toHaveBeenCalledTimes(1))
    const url = new URL(redirect.mock.calls[0][0])
    expect(url.pathname).toBe('/logout')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.example.com/bye'
    )
    expect(url.searchParams.get('id_token_hint')).toBe('eyJ.id.tok')

    // Local teardown still happened before leaving…
    expect(await storage.getItem(SESSION_KEY)).toBeNull()
    // …the other tabs were told…
    expect(posted).toContainEqual({ event: 'SIGNED_OUT', session: null })
    // …and nothing in this document was.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(events).not.toContain('SIGNED_OUT')
  })

  it('still tells this document SIGNED_OUT when there is no redirect', async () => {
    const { auth } = seededClient()
    const redirect = vi
      .spyOn(windowHelpers, 'redirect')
      .mockImplementation(() => {})
    const events: string[] = []
    auth.onAuthStateChange(event => {
      events.push(event)
    })

    await auth.signOut({ scope: 'global', redirect: false })

    expect(redirect).not.toHaveBeenCalled()
    expect(events).toContain('SIGNED_OUT')
    expect(posted).toContainEqual({ event: 'SIGNED_OUT', session: null })
  })
})
