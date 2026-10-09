import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { _post } from '../../src/lib/fetch'
import { loadCodeVerifier } from '../../src/lib/pkce_storage'
import type { SupportedStorage } from '../../src/lib/types'

// §305: auth-js sent `redirect_uri` to /authorize but OMITTED it at the token
// exchange, so the server's §4.1.3 rebinding check rejected the canje
// (`redirect_uri_mismatch`). The fix persists the exact /authorize redirect_uri
// alongside the PKCE verifier and replays it in the /oauth/token body.

vi.mock('../../src/lib/fetch', () => ({
  _post: vi.fn(async () => ({ data: null, error: null })),
  _get: vi.fn(async () => ({ data: null, error: null }))
}))
const mPost = _post as unknown as ReturnType<typeof vi.fn>

const inMemoryStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
}

const REDIRECT = 'https://app.example.com/cb'

const makeClient = (storage: SupportedStorage) =>
  createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage,
    storageKey: 'faable-auth-token',
    autoRefreshToken: false,
    flowType: 'pkce',
    redirectUri: REDIRECT
  } as any)

beforeEach(() => {
  mPost.mockReset()
  mPost.mockResolvedValue({ data: null, error: null })
})

describe('§305: redirect_uri is replayed at the token exchange', () => {
  it('persists the exact /authorize redirect_uri alongside the verifier', async () => {
    const storage = inMemoryStorage()
    const auth = makeClient(storage)

    const { data } = await auth.signInWithOauthConnection({
      connection_id: 'connection_db',
      skipBrowserRedirect: true
    })

    const url = new URL(data!.url!)
    const stored = await loadCodeVerifier(
      storage,
      'faable-auth-token-test-client-code-verifier'
    )
    // The same string in both places — that is the whole point.
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(stored?.redirectUri).toBe(REDIRECT)
  })

  it('sends that same redirect_uri in the /oauth/token body', async () => {
    const storage = inMemoryStorage()
    const auth = makeClient(storage)

    // Seed the verifier + redirectUri the way a real /authorize would.
    await auth.signInWithOauthConnection({
      connection_id: 'connection_db',
      skipBrowserRedirect: true
    })

    // Drive the exchange directly; we only assert the request it builds.
    await (auth as any)._exchangeCodeForSession('the-code').catch(() => {})

    const tokenCall = mPost.mock.calls.find(c =>
      String(c[0]).endsWith('/oauth/token')
    )
    expect(tokenCall, 'a POST to /oauth/token was made').toBeTruthy()
    expect(tokenCall?.[1]).toMatchObject({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: REDIRECT
    })
    expect(tokenCall?.[1]).toHaveProperty('code_verifier')
  })
})
