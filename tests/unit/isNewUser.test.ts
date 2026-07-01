import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { Session, SupportedStorage } from '../../src/lib/types'

// A mutable browser-ish environment. The client imports `window`/`document`/
// `fetch` from ./lib/globals (captured at module load), so we mock that module
// to look like a browser. `location.href` is swapped per test to simulate the
// callback URL. `isBrowser()` separately checks the *global* `document`, so we
// also stub that below.
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
  // Make isBrowser() (typeof document !== 'undefined') true, and satisfy the
  // bare-global `window` that url_helpers.clearURLParameters references.
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
  // Stub the PKCE code exchange so the callback resolves to a session without
  // any network; the test only asserts the `signup` marker threading.
  vi.spyOn(
    FaableAuthClient.prototype as any,
    '_exchangeCodeForSession'
  ).mockResolvedValue({
    data: {
      session: fakeSession(),
      user: { sub: 'user_1' },
      redirectType: null,
      returnTo: null
    },
    error: null
  })
})

describe('is_new_user surfaced from the callback', () => {
  it('is true when the callback URL carries ?signup=true', async () => {
    h.loc.href = 'https://app.example.com/cb?code=abc&signup=true'
    const auth = new FaableAuthClient(config())
    const result = await auth.handleRedirectCallback()
    expect(result.error).toBeNull()
    expect(result.is_new_user).toBe(true)
  })

  it('is false for a returning-user callback (no signup marker)', async () => {
    h.loc.href = 'https://app.example.com/cb?code=abc'
    const auth = new FaableAuthClient(config())
    const result = await auth.handleRedirectCallback()
    expect(result.error).toBeNull()
    expect(result.is_new_user).toBe(false)
  })
})
