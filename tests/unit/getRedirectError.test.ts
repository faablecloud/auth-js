import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { Session, SupportedStorage } from '../../src/lib/types'

// Same browser-ish harness as isNewUser.test.ts: the client imports
// `window`/`document`/`fetch` from ./lib/globals (captured at module load),
// so that module is mocked to look like a browser and `location.href` is
// swapped per test to simulate the URL the auth server redirected back to.
const h = vi.hoisted(() => {
  const loc = { href: '', origin: 'https://app.example.com' }
  return {
    loc,
    fakeWindow: {
      location: loc,
      history: { state: null, replaceState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  }
})
vi.mock('../../src/lib/globals', () => ({
  window: h.fakeWindow,
  document: {},
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
}))

const inMemoryStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
}

const fakeSession = (): Session =>
  ({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: Math.round(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: { sub: 'user_1' }
  }) as unknown as Session

const config = () => ({
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  storage: inMemoryStorage(),
  autoRefreshToken: false as const
})

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
})

// The auth server now returns action denies to the RP as an RFC 6749
// §4.1.2.1 error redirect (2026-08-21 — before that a deny died as a raw
// 401 on the auth domain and the app saw nothing). The promise returned by
// signInWithOauthConnection dies with the top-level navigation, so
// getRedirectError() is the only way the app can learn the motive.
describe('getRedirectError', () => {
  it('surfaces a server-returned error redirect, consume-once', async () => {
    h.loc.href =
      'https://app.example.com/page?error=access_denied&error_description=Signups+from+this+network+are+currently+restricted.'
    const auth = new FaableAuthClient(config())

    const err = await auth.getRedirectError()
    expect(err).not.toBeNull()
    expect(err!.error).toBe('access_denied')
    expect(err!.error_description).toBe(
      'Signups from this network are currently restricted.'
    )

    // Second read: consumed.
    expect(await auth.getRedirectError()).toBeNull()
  })

  it('returns null on a page not reached through a failed round-trip', async () => {
    h.loc.href = 'https://app.example.com/page'
    const auth = new FaableAuthClient(config())
    expect(await auth.getRedirectError()).toBeNull()
  })

  it('keeps an existing session when the redirect carries an error', async () => {
    // A signed-in user failing a CONNECT round-trip must stay signed in —
    // before this fix _initialize removed the session on any URL error,
    // turning a denied GitHub connect into a logout.
    const cfg = config()
    const storage = cfg.storage
    const session = fakeSession()
    // Seed a persisted session under the client's storage key.
    h.loc.href = 'https://app.example.com/page'
    const seeded = new FaableAuthClient(cfg)
    await (seeded as any)._saveSession(session)

    h.loc.href =
      'https://app.example.com/page?error=access_denied&error_description=denied'
    const auth = new FaableAuthClient({ ...cfg, storage })
    const { error } = await auth.initialize()
    expect(error).not.toBeNull()

    const { data } = await auth.getSession()
    expect(data.session).not.toBeNull()
    expect(data.session!.access_token).toBe('access')
  })
})
