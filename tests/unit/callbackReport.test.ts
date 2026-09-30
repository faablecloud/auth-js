import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { SupportedStorage } from '../../src/lib/types'

// Same browser-ish harness as isNewUser.test.ts, but with a fetch the test
// controls: the report is a side request, and what is asserted is whether it
// leaves, with which event and which stage.
const h = vi.hoisted(() => {
  const loc = { href: '', origin: 'https://app.example.com' }
  return {
    loc,
    fetch: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
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

const VERIFIER_KEY = 'faableauth-test-client-code-verifier'

const config = (storage = inMemoryStorage()) => ({
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  storage,
  autoRefreshToken: false as const
})

const withVerifier = () => {
  const storage = inMemoryStorage()
  storage.setItem(
    VERIFIER_KEY,
    JSON.stringify({ verifier: 'v'.repeat(56), createdAt: Date.now() })
  )
  return storage
}

const reports = () =>
  h.fetch.mock.calls
    .filter(([url]) => String(url).endsWith('/sdk/report'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
  h.fetch = vi.fn(async () => ({
    ok: true,
    status: 204,
    json: async () => ({})
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('callback reports', () => {
  it('reports a code with no verifier, at the stage it failed', async () => {
    h.loc.href = 'https://app.example.com/cb?code=abc'
    const auth = new FaableAuthClient(config())
    const { error } = await auth.initialize()

    expect(error).not.toBeNull()
    expect(reports()).toEqual([
      {
        client_id: 'test-client',
        event: 'callback_no_verifier',
        stage: 'verifier_loading'
      }
    ])
    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://tenant.auth.faable.link/sdk/report')
    expect(init.keepalive).toBe(true)
  })

  it('reports a stalled exchange with the stage it is stuck in', async () => {
    h.loc.href = 'https://app.example.com/cb?code=abc'
    // The token request leaves and never comes back.
    h.fetch = vi.fn((url: string) =>
      url.endsWith('/oauth/token')
        ? new Promise(() => {})
        : Promise.resolve({ ok: true, status: 204, json: async () => ({}) })
    )
    new FaableAuthClient(config(withVerifier()))

    await vi.advanceTimersByTimeAsync(14_000)
    expect(reports()).toEqual([])

    await vi.advanceTimersByTimeAsync(1_000)
    expect(reports()).toEqual([
      {
        client_id: 'test-client',
        event: 'callback_stalled',
        stage: 'token_request_sent',
        elapsed_ms: 15_000
      }
    ])
  })

  it('reports nothing when the exchange completes', async () => {
    h.loc.href = 'https://app.example.com/cb?code=abc'
    h.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        token_type: 'bearer',
        user: { sub: 'user_1' }
      })
    }))
    const auth = new FaableAuthClient(config(withVerifier()))
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reports()).toEqual([])
  })

  it('does not watch a page load without a code', async () => {
    h.loc.href = 'https://app.example.com/home'
    const auth = new FaableAuthClient(config())
    await auth.initialize()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reports()).toEqual([])
  })

  it('a failing report never breaks the callback', async () => {
    h.loc.href = 'https://app.example.com/cb?code=abc'
    h.fetch = vi.fn(() => {
      throw new TypeError('Load failed')
    })
    const auth = new FaableAuthClient(config())
    const { error } = await auth.initialize()
    expect(error?.message).toMatch(/PKCE code verifier/)
  })
})
