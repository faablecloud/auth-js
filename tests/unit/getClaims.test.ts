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

// Unsigned-looking JWT: getClaims decodes, it never verifies.
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

describe('getClaims', () => {
  it('decodes standard and custom claims of the access token', async () => {
    const now = Math.round(Date.now() / 1000)
    mockSession(
      sessionWith(
        jwtWith({
          iss: 'https://tenant.auth.faable.link',
          sub: 'user_1',
          aud: 'https://tenant.auth.faable.link/userinfo',
          exp: now + 3600,
          iat: now,
          scope: 'openid profile',
          'ciapol.com/station_id': 'station_123456789',
          'ciapol.com/tags': ['a', 'b']
        })
      )
    )
    const { data, error } = await client().getClaims<{
      'ciapol.com/station_id': string
    }>()
    expect(error).toBeNull()
    expect(data.claims?.sub).toBe('user_1')
    expect(data.claims?.scope).toBe('openid profile')
    expect(data.claims?.['ciapol.com/station_id']).toBe('station_123456789')
    expect(data.claims?.['ciapol.com/tags']).toEqual(['a', 'b'])
    expect(data.session?.access_token).toBeTruthy()
  })

  it('returns null claims and no error when signed out', async () => {
    mockSession(null)
    const { data, error } = await client().getClaims()
    expect(error).toBeNull()
    expect(data.claims).toBeNull()
    expect(data.session).toBeNull()
  })

  it('returns an error instead of throwing on a token that is not a JWT', async () => {
    mockSession(sessionWith('not-a-jwt'))
    const { data, error } = await client().getClaims()
    expect(data.claims).toBeNull()
    expect(error?.message).toMatch(/Could not decode/)
  })

  it('getClaim returns one claim, null when absent or signed out', async () => {
    mockSession(
      sessionWith(
        jwtWith({ sub: 'user_1', 'ciapol.com/station_id': 'station_123456789' })
      )
    )
    expect(await client().getClaim<string>('ciapol.com/station_id')).toBe(
      'station_123456789'
    )
    expect(await client().getClaim('missing')).toBeNull()
    mockSession(null)
    expect(await client().getClaim('ciapol.com/station_id')).toBeNull()
  })
})
