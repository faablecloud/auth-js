import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { Session, SupportedStorage } from '../../src/lib/types'

// Browser-ish harness (see isNewUser.test.ts for the rationale).
const h = vi.hoisted(() => {
  const loc = {
    href: 'https://app.example.com/page',
    origin: 'https://app.example.com'
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

const inMemoryStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
}

const config = () => ({
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  storage: inMemoryStorage(),
  autoRefreshToken: false as const
})

const fakeSession = (): Session =>
  ({
    access_token: 'access-abc',
    refresh_token: 'refresh',
    expires_at: Math.round(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: { sub: 'user_1' }
  }) as unknown as Session

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
  net.calls.length = 0
  net.impl = async () => ({ ok: true, status: 200, json: async () => ({}) })
})

// linkOauthConnection attaches an identity to the SIGNED-IN user. Its /authorize
// URL must carry link=true (that is what flips the server into link mode and
// what makes it refuse to mint a duplicate user), and the round-trip must not
// be recorded as a login attempt — connecting a repo is not how the user
// signs in, so the "last used login method" hint must not flip.
describe('linkOauthConnection', () => {
  it('builds an /authorize URL with link=true and no login attempt', async () => {
    const auth = new FaableAuthClient(config())
    const saveAttempt = vi.spyOn(auth as any, '_saveLoginAttempt')

    const { data } = await auth.linkOauthConnection({
      connection_id: 'connection_github',
      redirectTo: 'https://app.example.com/return',
      skipBrowserRedirect: true
    })

    const url = new URL(data!.url!)
    expect(url.pathname).toBe('/authorize')
    expect(url.searchParams.get('link')).toBe('true')
    expect(url.searchParams.get('connection_id')).toBe('connection_github')
    expect(url.searchParams.get('prompt')).toBeNull()
    expect(saveAttempt).not.toHaveBeenCalled()
  })

  // A session obtained through a direct grant (OTP) has no cookie on the
  // auth host, so the server would answer login_required. The SDK trades the
  // access token for a single-use ticket and sends it along; the server
  // bootstraps its session from it (arch/auth/link-mode-session-ticket.md).
  it('with a session, mints a link ticket with the access token and sends it', async () => {
    net.impl = async (url: string) =>
      url.endsWith('/oauth/link_ticket')
        ? {
            ok: true,
            status: 200,
            json: async () => ({ link_ticket: 'tkt_123', expires_in: 60 })
          }
        : { ok: true, status: 200, json: async () => ({}) }

    const auth = new FaableAuthClient(config())
    await (auth as any)._saveSession(fakeSession())

    const { data } = await auth.linkOauthConnection({
      connection_id: 'connection_github',
      skipBrowserRedirect: true
    })

    const mint = net.calls.find(c => c.url.endsWith('/oauth/link_ticket'))
    expect(mint).toBeTruthy()
    expect(mint!.url).toBe('https://tenant.auth.faable.link/oauth/link_ticket')
    expect(mint!.init.method).toBe('POST')
    expect(mint!.init.headers.Authorization).toBe('Bearer access-abc')

    const url = new URL(data!.url!)
    expect(url.searchParams.get('link')).toBe('true')
    expect(url.searchParams.get('link_ticket')).toBe('tkt_123')
  })

  it('without a session, sends no ticket and never calls the endpoint', async () => {
    const auth = new FaableAuthClient(config())

    const { data } = await auth.linkOauthConnection({
      connection_id: 'connection_github',
      skipBrowserRedirect: true
    })

    expect(net.calls.some(c => c.url.endsWith('/oauth/link_ticket'))).toBe(
      false
    )
    const url = new URL(data!.url!)
    expect(url.searchParams.get('link')).toBe('true')
    expect(url.searchParams.get('link_ticket')).toBeNull()
  })

  it('a failing ticket endpoint (older server, 404) degrades to a ticket-less link', async () => {
    net.impl = async (url: string) =>
      url.endsWith('/oauth/link_ticket')
        ? {
            ok: false,
            status: 404,
            json: async () => ({ message: 'Route not found' })
          }
        : { ok: true, status: 200, json: async () => ({}) }

    const auth = new FaableAuthClient(config())
    await (auth as any)._saveSession(fakeSession())

    const { data, error } = await auth.linkOauthConnection({
      connection_id: 'connection_github',
      skipBrowserRedirect: true
    })

    expect(error).toBeNull()
    const url = new URL(data!.url!)
    expect(url.searchParams.get('link')).toBe('true')
    expect(url.searchParams.get('link_ticket')).toBeNull()
  })

  it('a network failure while minting degrades to a ticket-less link', async () => {
    net.impl = async (url: string) => {
      if (url.endsWith('/oauth/link_ticket'))
        throw new TypeError('Failed to fetch')
      return { ok: true, status: 200, json: async () => ({}) }
    }

    const auth = new FaableAuthClient(config())
    await (auth as any)._saveSession(fakeSession())

    const { data, error } = await auth.linkOauthConnection({
      connection_id: 'connection_github',
      skipBrowserRedirect: true
    })

    expect(error).toBeNull()
    expect(new URL(data!.url!).searchParams.get('link_ticket')).toBeNull()
  })

  it('signInWithOauthConnection stays link-free and records the attempt', async () => {
    const auth = new FaableAuthClient(config())
    const saveAttempt = vi
      .spyOn(auth as any, '_saveLoginAttempt')
      .mockResolvedValue(undefined)

    const { data } = await auth.signInWithOauthConnection({
      connection_id: 'connection_github',
      skipBrowserRedirect: true
    })

    const url = new URL(data!.url!)
    expect(url.searchParams.get('link')).toBeNull()
    expect(saveAttempt).toHaveBeenCalled()
  })
})
