import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { Session, SupportedStorage } from '../../src/lib/types'

// Refresh-failure classification + the consume-once sign-out reason
// (arch/auth/suspension-logout.md). Three contracts:
//   1. A definitive 4xx from the token endpoint kills the session AND
//      records WHY (code `user_suspended`) for the login page to read.
//   2. A network failure / 5xx is NOT a verdict: the session survives.
//      (Historically every failure here signed the user out — fatal with
//      30-min tokens, where a refresh rides on every wifi blip.)
//   3. A voluntary signOut leaves no reason behind.
const h = vi.hoisted(() => {
  const loc = { href: '', origin: 'https://app.example.com' }
  return {
    loc,
    fakeWindow: {
      location: loc,
      history: { state: null, replaceState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    fetchImpl: null as null | ((...args: unknown[]) => Promise<unknown>)
  }
})
vi.mock('../../src/lib/globals', () => ({
  window: h.fakeWindow,
  document: {},
  fetch: (...args: unknown[]) => {
    if (!h.fetchImpl) throw new Error('fetchImpl not set for this test')
    return h.fetchImpl(...args)
  }
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
  h.loc.href = 'https://app.example.com/page'
  h.fetchImpl = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sign-out reason on terminal refresh failure', () => {
  it('a 403 invalid_grant removes the session, fires SIGNED_OUT and stashes the code', async () => {
    h.fetchImpl = async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'user is suspended',
        error_code: 'user_suspended'
      })
    })

    const auth = new FaableAuthClient(config())
    await (auth as any)._saveSession(fakeSession())

    const events: string[] = []
    auth.onAuthStateChange(event => {
      events.push(event)
    })

    const result = await (auth as any)._callRefreshToken('refresh')
    expect(result.session).toBeNull()
    expect(result.error?.code).toBe('user_suspended')
    expect(events).toContain('SIGNED_OUT')
    expect((await auth.getSession()).data.session).toBeNull()

    const reason = await auth.getSignOutReason()
    expect(reason).not.toBeNull()
    expect(reason!.code).toBe('user_suspended')
    expect(reason!.message).toBe('user is suspended')
    expect(reason!.at).toBeGreaterThan(0)

    // Consume-once.
    expect(await auth.getSignOutReason()).toBeNull()
  })

  it('a network failure keeps the session and stashes nothing', async () => {
    vi.useFakeTimers()
    h.fetchImpl = async () => {
      throw new TypeError('Failed to fetch')
    }

    const auth = new FaableAuthClient(config())
    await (auth as any)._saveSession(fakeSession())

    const events: string[] = []
    auth.onAuthStateChange(event => {
      events.push(event)
    })

    const pending = (auth as any)._callRefreshToken('refresh')
    await vi.runAllTimersAsync() // drain the retry backoff sleeps
    const result = await pending

    expect(result.session).toBeNull()
    expect(result.error).toBeTruthy()
    expect(events).not.toContain('SIGNED_OUT')
    // The session survives — the failure was not a server verdict.
    expect(
      await (auth as any).storage.getItem((auth as any).storageKey)
    ).not.toBeNull()
    expect(await auth.getSignOutReason()).toBeNull()
  })

  it('a 5xx keeps the session and stashes nothing', async () => {
    vi.useFakeTimers()
    h.fetchImpl = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ message: 'upstream unavailable' })
    })

    const auth = new FaableAuthClient(config())
    await (auth as any)._saveSession(fakeSession())

    const pending = (auth as any)._callRefreshToken('refresh')
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.session).toBeNull()
    expect(result.error).toBeTruthy()
    expect(
      await (auth as any).storage.getItem((auth as any).storageKey)
    ).not.toBeNull()
    expect(await auth.getSignOutReason()).toBeNull()
  })

  it('voluntary signOut leaves no reason behind', async () => {
    const auth = new FaableAuthClient(config())
    await (auth as any)._saveSession(fakeSession())

    await auth.signOut({ scope: 'local' })

    expect((await auth.getSession()).data.session).toBeNull()
    expect(await auth.getSignOutReason()).toBeNull()
  })
})
