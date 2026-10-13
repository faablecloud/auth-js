import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import { saveCodeVerifier } from '../../src/lib/pkce_storage'
import type { SupportedStorage } from '../../src/lib/types'

// A callback code whose exchange FAILS — expired, already redeemed, refused —
// is dead: authorization codes are single-use. It must leave the URL, or a
// reload replays the failure (2026-10-13: admin.faable.com kept its dead
// `?code=` and its «Try again» re-entered the same error).
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

const config = (storage: SupportedStorage) => ({
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  storage,
  autoRefreshToken: false as const,
  flowType: 'pkce' as const
})

beforeEach(() => {
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
  h.fetch = vi.fn(async (url: string) =>
    String(url).endsWith('/oauth/token')
      ? {
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'The authorization code has expired'
          })
        }
      : { ok: true, status: 204, json: async () => ({}) }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a callback code whose exchange fails', () => {
  it("leaves the URL, keeping the app's own state", async () => {
    const storage = inMemoryStorage()
    await saveCodeVerifier(storage, `${STORAGE_KEY}-code-verifier`, {
      verifier: 'verifier_abc',
      sentState: true
    })
    h.loc.href =
      'https://app.example.com/area?code=dead_code&signup=true&state=app-state&iss=https%3A%2F%2Ftenant.auth.faable.link'

    const auth = new FaableAuthClient(config(storage))
    const { error } = await auth.initialize()

    expect(error).not.toBeNull()
    expect(h.loc.href).toBe('https://app.example.com/area?state=app-state')
    const { data } = await auth.getSession()
    expect(data.session).toBeNull()
  })
})
