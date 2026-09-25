import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { STORAGE_KEY } from '../../src/lib/constants'
import type { SupportedStorage } from '../../src/lib/types'

// Backlog §241 — signOut scopes do what their docs say: `others` calls
// POST /me/sessions/revoke-others with the access token and keeps the local
// session; `local` touches storage only and never the server.

const h = vi.hoisted(() => {
  const loc = {
    href: 'https://app.example.com/area',
    origin: 'https://app.example.com',
    assign: (_url: string) => {}
  }
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

const net = vi.hoisted(() => ({
  calls: [] as { url: string; init: any }[],
  impl: async (_url: string, _init: any): Promise<any> => ({
    ok: true,
    status: 200,
    json: async () => ({})
  })
}))

vi.mock('../../src/lib/globals', () => ({
  window: h.fakeWindow,
  document: {},
  fetch: async (url: string, init: any) => {
    net.calls.push({ url, init })
    return net.impl(url, init)
  }
}))

const CLIENT_ID = 'test-client'

const storageWithSession = () => {
  const store = new Map<string, string>()
  const storage: SupportedStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
  storage.setItem(
    `${STORAGE_KEY}-${CLIENT_ID}`,
    JSON.stringify({
      access_token: 'at_1',
      refresh_token: 'rt_1',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: { sub: 'user_1' }
    })
  )
  return storage
}

const client = (storage: SupportedStorage) =>
  createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: CLIENT_ID,
    storage,
    autoRefreshToken: false
  })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  net.calls.length = 0
  net.impl = async () => ({ ok: true, status: 200, json: async () => ({}) })
})

describe("signOut({ scope: 'others' })", () => {
  it('POSTs /me/sessions/revoke-others with the access token and keeps the local session', async () => {
    vi.stubGlobal('document', {})
    net.impl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ revoked: 2 })
    })
    const auth = client(storageWithSession())
    const events: string[] = []
    auth.onAuthStateChange(ev => void events.push(ev))

    const { error } = await auth.signOut({ scope: 'others' })
    expect(error).toBeNull()

    const call = net.calls.find(c =>
      c.url.endsWith('/me/sessions/revoke-others')
    )
    expect(call).toBeTruthy()
    expect(call!.init.method).toBe('POST')
    expect(call!.init.headers.Authorization).toBe('Bearer at_1')
    // No /logout, no local teardown, no SIGNED_OUT.
    expect(net.calls.some(c => c.url.includes('/logout'))).toBe(false)
    const { data } = await auth.getSession()
    expect(data.session?.access_token).toBe('at_1')
    expect(events).not.toContain('SIGNED_OUT')
  })

  it('surfaces the server refusal as an AuthApiError with its code', async () => {
    vi.stubGlobal('document', {})
    net.impl = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'not logged in',
        error_code: 'not_logged_in'
      })
    })
    const auth = client(storageWithSession())
    const { error } = await auth.signOut({ scope: 'others' })
    expect(error?.name).toBe('AuthApiError')
    expect(error?.status).toBe(401)
    expect(error?.code).toBe('not_logged_in')
  })

  it('without a session it is AuthSessionMissingError and nothing is sent', async () => {
    const store = new Map<string, string>()
    const auth = client({
      getItem: k => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: k => void store.delete(k)
    })
    const { error } = await auth.signOut({ scope: 'others' })
    expect(error?.name).toBe('AuthSessionMissingError')
    expect(net.calls.length).toBe(0)
  })
})

describe("signOut({ scope: 'local' })", () => {
  it('clears storage and fires SIGNED_OUT without calling the server', async () => {
    vi.stubGlobal('document', {})
    const auth = client(storageWithSession())
    const events: string[] = []
    auth.onAuthStateChange(ev => void events.push(ev))

    const { error } = await auth.signOut({ scope: 'local' })
    expect(error).toBeNull()
    expect(net.calls.length).toBe(0)
    const { data } = await auth.getSession()
    expect(data.session).toBeNull()
    expect(events).toContain('SIGNED_OUT')
  })
})
