import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { Session, SupportedStorage } from '../../src/lib/types'

// A `?code=` this client holds no verifier for must not cost the user the
// session they already have.
//
// 2026-10-05 (arch/recordings/recordings-review-2026-10-06.md §1): a signed-in
// user's browser asked auth for an `/authorize` URL it had already used —
// same `code_challenge`, no click. Auth answered by silent SSO with a fresh
// code; the verifier for that challenge had been consumed by the first
// exchange, so this client reported `callback_no_verifier` and then fell
// through to `_removeSession()`. Seven times in 14 minutes, each one a
// re-login, on someone who had deployed 6 minutes earlier.
//
// Without the verifier nothing can be exchanged, so this was never a login
// attempt of ours that failed — there is nothing to invalidate the old
// session for.
const h = vi.hoisted(() => {
  const loc = { href: '', origin: 'https://app.example.com' }
  return {
    loc,
    fakeWindow: {
      location: loc,
      history: {
        state: null,
        replaceState: (_s: unknown, _t: string, url: string) => {
          loc.href = url
        }
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    fetch: null as unknown as ReturnType<typeof import('vitest').vi.fn>
  }
})
vi.mock('../../src/lib/globals', () => ({
  window: h.fakeWindow,
  document: {},
  fetch: (...args: unknown[]) => h.fetch(...args)
}))

const inMemoryStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
}

const STORAGE_KEY = 'faableauth-test-client'

const fakeSession = (): Session =>
  ({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: Math.round(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: { sub: 'user_1' }
  }) as unknown as Session

const config = (storage: SupportedStorage) => ({
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  storage,
  autoRefreshToken: false as const
})

beforeEach(() => {
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
  h.fetch = vi.fn(async () => ({
    ok: true,
    status: 204,
    json: async () => ({})
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a callback code with no verifier', () => {
  it('keeps the session already in storage', async () => {
    const storage = inMemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(fakeSession()))
    h.loc.href = 'https://app.example.com/?code=dc0efbeb-647e-42d7'

    const auth = new FaableAuthClient(config(storage))
    const { error } = await auth.initialize()

    expect(error?.name).toBe('AuthPKCEGrantCodeExchangeError')
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull()
    const { data } = await auth.getSession()
    expect(data.session?.access_token).toBe('access')
  })

  it('strips the code it cannot use from the URL', async () => {
    const storage = inMemoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(fakeSession()))
    h.loc.href = 'https://app.example.com/?code=dc0efbeb-647e-42d7&signup=true'

    const auth = new FaableAuthClient(config(storage))
    await auth.initialize()

    expect(h.loc.href).toBe('https://app.example.com/')
  })

  it('with nothing stored, still leaves the user signed out', async () => {
    const storage = inMemoryStorage()
    h.loc.href = 'https://app.example.com/?code=abc'

    const auth = new FaableAuthClient(config(storage))
    const { error } = await auth.initialize()

    expect(error).not.toBeNull()
    const { data } = await auth.getSession()
    expect(data.session).toBeNull()
  })
})
