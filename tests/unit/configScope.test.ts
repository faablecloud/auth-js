import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import type { SupportedStorage } from '../../src/lib/types'

// `createClient({ scope })` es el scope por defecto de cada /authorize. Hasta
// 3.8.0 el constructor no lo asignaba y viajaba siempre `openid profile
// email`: una SPA con `audience` de una Api con RBAC recibía un access token
// con `permissions` vacío (Auth concede pedidos ∩ catálogo ∩ roles).

const h = vi.hoisted(() => {
  const loc = {
    href: 'https://app.example.com/admin',
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

const SCOPE = 'openid profile email instances:admin bookings:read'

const client = (scope?: string) =>
  new FaableAuthClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage: inMemoryStorage(),
    autoRefreshToken: false,
    audience: 'https://api.example.com',
    ...(scope !== undefined ? { scope } : {})
  } as any)

const authorizeUrl = async (
  auth: FaableAuthClient,
  call: 'signIn' | 'signInWithOauthConnection',
  scopes?: string
) => {
  const { data } = await auth[call]({
    skipBrowserRedirect: true,
    ...(scopes ? { scopes } : {})
  })
  return new URL(data!.url!)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
})

describe('scope de createClient', () => {
  it.each(['signIn', 'signInWithOauthConnection'] as const)(
    '%s pide el scope configurado',
    async call => {
      const url = await authorizeUrl(client(SCOPE), call)

      expect(url.searchParams.get('scope')).toBe(SCOPE)
      expect(url.searchParams.get('audience')).toBe('https://api.example.com')
    }
  )

  it('el `scopes` de la llamada manda sobre el configurado', async () => {
    const url = await authorizeUrl(client(SCOPE), 'signIn', 'openid')

    expect(url.searchParams.get('scope')).toBe('openid')
  })

  it('sin scope configurado sigue pidiendo openid profile email', async () => {
    const url = await authorizeUrl(client(), 'signIn')

    expect(url.searchParams.get('scope')).toBe('openid profile email')
  })

  it('buildAuthorizeUrl también usa el scope configurado', () => {
    const url = new URL(client(SCOPE).buildAuthorizeUrl())

    expect(url.searchParams.get('scope')).toBe(SCOPE)
  })

  it('buildAuthorizeUrl sin scope configurado no añade ninguno', () => {
    const url = new URL(client().buildAuthorizeUrl())

    expect(url.searchParams.has('scope')).toBe(false)
  })
})
