import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { STORAGE_KEY } from '../../src/lib/constants'
import type { SupportedStorage } from '../../src/lib/types'

// Backlog §241 — getTokenSilently: refresh first; when the refresh is refused,
// a top-level `/authorize?prompt=none` navigation (no iframe); never a loop.

const h = vi.hoisted(() => {
  const loc = {
    href: 'https://app.example.com/area',
    origin: 'https://app.example.com',
    assign: (_url: string) => {}
  }
  const history = {
    state: null,
    replaceState: (_s: unknown, _t: string, url: string) => {
      loc.href = url
    }
  }
  return {
    loc,
    fakeWindow: {
      location: loc,
      history,
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  }
})

const net = vi.hoisted(() => ({
  impl: async (_url: string, _init: any): Promise<any> => ({
    ok: true,
    status: 200,
    json: async () => ({})
  })
}))

vi.mock('../../src/lib/globals', () => ({
  window: h.fakeWindow,
  document: {},
  fetch: async (url: string, init: any) => net.impl(url, init)
}))

const inMemoryStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
}

const CLIENT_ID = 'test-client'

const seeded = (session: Record<string, unknown> | null) => {
  const storage = inMemoryStorage()
  if (session) {
    storage.setItem(`${STORAGE_KEY}-${CLIENT_ID}`, JSON.stringify(session))
  }
  return storage
}

const liveSession = () => ({
  access_token: 'at_old',
  refresh_token: 'rt_old',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: 'bearer',
  user: { sub: 'user_1' }
})

const tokenOk = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    access_token: 'at_new',
    refresh_token: 'rt_new',
    expires_in: 3600,
    token_type: 'bearer',
    user: { sub: 'user_1' }
  })
})

const tokenRefused = () => ({
  ok: false,
  status: 400,
  json: async () => ({ error: 'invalid_grant' })
})

const client = (storage: SupportedStorage) =>
  createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: CLIENT_ID,
    redirectUri: 'https://app.example.com/callback',
    storage,
    autoRefreshToken: false
  })

const tick = () => new Promise(r => setTimeout(r, 20))

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  h.loc.href = 'https://app.example.com/area'
  net.impl = async () => tokenOk()
})

describe('getTokenSilently', () => {
  it('refreshes first and returns the new access token, no navigation', async () => {
    const assign = vi.spyOn(h.loc, 'assign')
    const calls: string[] = []
    net.impl = async (url: string) => {
      calls.push(url)
      return tokenOk()
    }
    const auth = client(seeded(liveSession()))
    const { data, error } = await auth.getTokenSilently()
    expect(error).toBeNull()
    expect(data?.access_token).toBe('at_new')
    expect(calls.some(u => u.endsWith('/oauth/token'))).toBe(true)
    expect(assign).not.toHaveBeenCalled()
  })

  it('when the refresh is refused it navigates top-level to /authorize?prompt=none and never resolves', async () => {
    vi.stubGlobal('document', {})
    net.impl = async () => tokenRefused()
    const assign = vi.spyOn(h.loc, 'assign')
    const auth = client(seeded(liveSession()))

    let settled = false
    auth.getTokenSilently().then(() => (settled = true))
    await tick()

    expect(settled).toBe(false)
    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe(
      'https://tenant.auth.faable.link/authorize'
    )
    expect(url.searchParams.get('prompt')).toBe('none')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/callback'
    )
    // The user's location is NOT in the URL: it travels with the verifier.
    expect(url.searchParams.get('returnTo')).toBeNull()
    // Silent: the PKCE verifier is stored, the "last used" hint is not touched.
    const storage = (auth as any).storage as SupportedStorage
    const stored = JSON.parse(
      (await storage.getItem(`${STORAGE_KEY}-${CLIENT_ID}-code-verifier`))!
    )
    expect(stored.returnTo).toBe('https://app.example.com/area')
  })

  it('redirect:false resolves with AuthLoginRequiredError instead of navigating', async () => {
    vi.stubGlobal('document', {})
    net.impl = async () => tokenRefused()
    const assign = vi.spyOn(h.loc, 'assign')
    const auth = client(seeded(liveSession()))
    const { data, error } = await auth.getTokenSilently({ redirect: false })
    expect(data).toBeNull()
    expect(error?.name).toBe('AuthLoginRequiredError')
    expect(error?.code).toBe('login_required')
    expect(assign).not.toHaveBeenCalled()
  })

  it('outside a browser it never navigates', async () => {
    const assign = vi.spyOn(h.loc, 'assign')
    const auth = client(seeded(null))
    const { error } = await auth.getTokenSilently()
    expect(error?.name).toBe('AuthLoginRequiredError')
    expect(assign).not.toHaveBeenCalled()
  })

  it('a network failure during the refresh is retryable, not a reason to navigate', async () => {
    vi.stubGlobal('document', {})
    net.impl = async () => {
      throw new Error('offline')
    }
    const assign = vi.spyOn(h.loc, 'assign')
    const auth = client(seeded(liveSession()))
    // The refresh retries with backoff for up to ~40 s of wall clock before
    // giving up: fake timers walk through that budget instead of waiting it.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pending = auth.getTokenSilently()
    await vi.advanceTimersByTimeAsync(90_000)
    const { data, error } = await pending
    vi.useRealTimers()
    expect(data).toBeNull()
    expect(error?.name).toBe('AuthRetryableFetchError')
    expect(assign).not.toHaveBeenCalled()
    // And the session survived the blip.
    const { data: after } = await auth.getSession()
    expect(after.session?.access_token).toBe('at_old')
  })

  it('on the return leg of a refused silent attempt (?error=login_required) it does not navigate again', async () => {
    vi.stubGlobal('document', {})
    // The error params are stripped through the real global `window`.
    vi.stubGlobal('window', h.fakeWindow)
    h.loc.href =
      'https://app.example.com/callback?error=login_required&error_description=no+session'
    net.impl = async () => tokenRefused()
    const assign = vi.spyOn(h.loc, 'assign')
    const auth = client(seeded(null))
    await auth.initialize()
    const { data, error } = await auth.getTokenSilently()
    expect(data).toBeNull()
    expect(error?.name).toBe('AuthLoginRequiredError')
    expect(error?.code).toBe('login_required')
    expect(assign).not.toHaveBeenCalled()
  })
})
