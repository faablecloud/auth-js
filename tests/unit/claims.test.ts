import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import { hasPermissions, hasRoles, permissionsOf } from '../../src/lib/claims'
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

describe('claims helpers', () => {
  it('reads permissions as Faable Auth emits them, and as an array', () => {
    expect(permissionsOf({ permissions: 'a:read a:write' })).toEqual([
      'a:read',
      'a:write'
    ])
    expect(permissionsOf({ permissions: '' })).toEqual([])
    expect(permissionsOf({ permissions: ['x'] })).toEqual(['x'])
    expect(permissionsOf(null)).toEqual([])
  })

  it('hasPermissions and hasRoles require all of them', () => {
    expect(hasPermissions({ permissions: 'a b' }, 'a')).toBe(true)
    expect(hasPermissions({ permissions: 'a b' }, ['a', 'b'])).toBe(true)
    expect(hasPermissions({ permissions: 'a' }, ['a', 'b'])).toBe(false)
    expect(hasRoles({ roles: ['admin', 'staff'] }, 'staff')).toBe(true)
    expect(hasRoles({ roles: ['staff'] }, ['admin', 'staff'])).toBe(false)
    expect(hasRoles(undefined, 'admin')).toBe(false)
  })
})

describe('hasPermission / hasRole', () => {
  it('read the access token of the current session', async () => {
    mockSession(
      sessionWith(
        jwtWith({
          sub: 'user_1',
          permissions: 'invites:read invites:write',
          roles: ['staff']
        })
      )
    )
    const auth = client()
    expect(await auth.hasPermission('invites:write')).toBe(true)
    expect(await auth.hasPermission(['invites:read', 'billing:read'])).toBe(
      false
    )
    expect(await auth.hasRole('staff')).toBe(true)
    expect(await auth.hasRole('admin')).toBe(false)
  })

  it('are false without a session', async () => {
    mockSession(null)
    const auth = client()
    expect(await auth.hasPermission('invites:read')).toBe(false)
    expect(await auth.hasRole('staff')).toBe(false)
  })
})
