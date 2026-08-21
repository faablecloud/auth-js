import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { SupportedStorage } from '../../src/lib/types'

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
