import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { Session, SupportedStorage } from '../../src/lib/types'

vi.mock('../../src/lib/globals', () => ({
  window: {
    location: {
      href: 'https://app.example.com/',
      origin: 'https://app.example.com'
    },
    history: { state: null, replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {}
  },
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

const b64url = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url')
const jwtWith = (payload: Record<string, unknown>) =>
  `${b64url({ alg: 'RS256', typ: 'JWT', kid: 'k1' })}.${b64url(payload)}.sig`

const sessionWith = (access_token: string): Session =>
  ({
    access_token,
    refresh_token: 'refresh',
    expires_at: Math.round(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: { sub: 'user_1' }
  }) as unknown as Session

const client = () =>
  new FaableAuthClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage: inMemoryStorage(),
    autoRefreshToken: false
  })

const mockSession = (session: Session | null) =>
  vi
    .spyOn(FaableAuthClient.prototype, 'getSession')
    .mockResolvedValue({ data: { session }, error: null } as any)

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('document', {})
})

describe('getAal', () => {
  it('is 2 when the token says a second factor was satisfied', async () => {
    mockSession(sessionWith(jwtWith({ sub: 'u', acr: 'urn:faable:loa:2' })))
    expect(await client().getAal()).toBe(2)
  })

  it('is 1 for a single-factor login', async () => {
    mockSession(sessionWith(jwtWith({ sub: 'u', acr: 'urn:faable:loa:1' })))
    expect(await client().getAal()).toBe(1)
  })

  it('treats a token with no acr as one factor, not none', async () => {
    // Tokens minted before the claim existed: a session is there, so it is
    // at least one factor — reporting 0 would log everybody out of UI gates.
    mockSession(sessionWith(jwtWith({ sub: 'u' })))
    expect(await client().getAal()).toBe(1)
  })

  it('is 0 with no session', async () => {
    mockSession(null)
    expect(await client().getAal()).toBe(0)
  })
})

describe('hasAmr', () => {
  it('answers from the amr claim', async () => {
    mockSession(sessionWith(jwtWith({ sub: 'u', amr: ['pwd', 'otp', 'mfa'] })))
    const auth = client()
    expect(await auth.hasAmr('mfa')).toBe(true)
    expect(await auth.hasAmr('hwk')).toBe(false)
  })

  it('is false when the claim is missing or malformed', async () => {
    mockSession(sessionWith(jwtWith({ sub: 'u', amr: 'pwd' })))
    expect(await client().hasAmr('pwd')).toBe(false)
  })
})

describe('buildAuthorizeUrl acr_values', () => {
  it('sends acr_values through', () => {
    const url = new URL(
      client().buildAuthorizeUrl({ acr_values: 'urn:faable:loa:2' })
    )
    expect(url.searchParams.get('acr_values')).toBe('urn:faable:loa:2')
  })

  it('joins several values with a space, per OIDC Core', () => {
    const url = new URL(
      client().buildAuthorizeUrl({
        acr_values: ['urn:faable:loa:2', 'urn:faable:loa:1']
      })
    )
    expect(url.searchParams.get('acr_values')).toBe(
      'urn:faable:loa:2 urn:faable:loa:1'
    )
  })

  it('omits the parameter when not asked for', () => {
    // The field was typed on AuthorizationParams long before it was sent;
    // callers that never set it must see no change in the URL they get.
    const url = new URL(client().buildAuthorizeUrl())
    expect(url.searchParams.has('acr_values')).toBe(false)
  })
})

describe('stepUp', () => {
  it('asks for loa:2 AND a fresh login', () => {
    const auth = client()
    const spy = vi.spyOn(auth, 'authorize').mockImplementation(() => {})
    auth.stepUp({ redirectTo: 'https://app.example.com/settings' })
    const options = spy.mock.calls[0][0]
    expect(options.acr_values).toBe('urn:faable:loa:2')
    // Without prompt=login the server may reuse the single-factor session
    // and hand back exactly the level being raised.
    expect(options.queryParams).toEqual({ prompt: 'login' })
    expect(options.redirectTo).toBe('https://app.example.com/settings')
  })
})
