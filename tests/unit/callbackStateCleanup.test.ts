import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import { saveCodeVerifier } from '../../src/lib/pkce_storage'
import type { SupportedStorage } from '../../src/lib/types'

// El caso completo, no la función pura: lo que casi se rompe al escribir esto
// fue el CABLEADO — el `return` de éxito del canje esparce `...data` con un
// `as any`, así que olvidar `sentState` ahí lo deja `undefined`, que se lee
// como «la app no mandó nada» y borra un `state` que SÍ era suyo.
// arch/auth/oauth-state-internal-key-leak.md

const h = vi.hoisted(() => {
  const loc = {
    href: 'https://app.example.com/area-privada',
    origin: 'https://app.example.com'
  }
  const history = {
    state: null,
    replaceState: (_s: unknown, _t: string, url: string) => {
      loc.href = url
    }
  }
  return {
    loc,
    history,
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

const tokenResponse = () => ({
  access_token: 'access-abc',
  refresh_token: 'refresh-abc',
  expires_in: 3600,
  token_type: 'bearer',
  user: { sub: 'user_1', id: 'user_1' }
})

const landOn = async ({ sentState }: { sentState: boolean }) => {
  h.loc.href =
    'https://app.example.com/area-privada?code=code_abc&state=a2dd7d12-b39b-4ad8-8300-3c0eebc2a478'

  const storage = inMemoryStorage()
  // Lo que dejó el /authorize de ida.
  await saveCodeVerifier(
    storage,
    'faable-auth-token-test-client-code-verifier',
    {
      verifier: 'verifier_abc',
      ...(sentState ? { sentState: true } : {})
    }
  )

  net.impl = async (url: string) =>
    url.endsWith('/oauth/token')
      ? { ok: true, status: 200, json: async () => tokenResponse() }
      : { ok: true, status: 200, json: async () => ({ id: 'user_1' }) }

  const auth = new FaableAuthClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage,
    storageKey: 'faable-auth-token',
    autoRefreshToken: false,
    flowType: 'pkce'
  } as any)

  await auth.handleRedirectCallback()
  return new URL(h.loc.href)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
})

describe('limpieza de la URL al volver del login', () => {
  it('borra un `state` que este cliente no mandó', async () => {
    const url = await landOn({ sentState: false })

    expect(url.searchParams.get('code')).toBeNull()
    expect(url.searchParams.get('state')).toBeNull()
  })

  it('deja intacto el `state` de la app', async () => {
    const url = await landOn({ sentState: true })

    expect(url.searchParams.get('code')).toBeNull()
    // Esto es lo que lee CORE al aterrizar. Si desaparece, pierde el dato.
    expect(url.searchParams.get('state')).toBe(
      'a2dd7d12-b39b-4ad8-8300-3c0eebc2a478'
    )
  })
})
