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

const landOn = async ({
  sentState,
  appState
}: {
  sentState: boolean
  appState?: unknown
}) => {
  h.loc.href =
    'https://app.example.com/area-privada?code=code_abc&state=a2dd7d12-b39b-4ad8-8300-3c0eebc2a478'

  const storage = inMemoryStorage()
  // Lo que dejó el /authorize de ida.
  await saveCodeVerifier(
    storage,
    'faable-auth-token-test-client-code-verifier',
    {
      verifier: 'verifier_abc',
      ...(sentState ? { sentState: true } : {}),
      ...(appState !== undefined ? { appState } : {})
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

  const result = await auth.handleRedirectCallback()
  return { url: new URL(h.loc.href), result }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
})

describe('limpieza de la URL al volver del login', () => {
  it('borra un `state` que este cliente no mandó', async () => {
    const { url } = await landOn({ sentState: false })

    expect(url.searchParams.get('code')).toBeNull()
    expect(url.searchParams.get('state')).toBeNull()
  })

  it('deja intacto el `state` de la app', async () => {
    const { url } = await landOn({ sentState: true })

    expect(url.searchParams.get('code')).toBeNull()
    // Esto es lo que lee CORE al aterrizar. Si desaparece, pierde el dato.
    expect(url.searchParams.get('state')).toBe(
      'a2dd7d12-b39b-4ad8-8300-3c0eebc2a478'
    )
  })
})

// `appState`: la alternativa a que la app meta sus datos en el `state` de
// OAuth. Va y vuelve por el navegador, nunca por la URL.
describe('appState', () => {
  it('vuelve ya deserializado, con su forma', async () => {
    const { result } = await landOn({
      sentState: false,
      appState: { course_key: 'abc', steps: [1, 2] }
    })

    expect(result.appState).toEqual({ course_key: 'abc', steps: [1, 2] })
  })

  it('no aparece en la URL en ningún momento', async () => {
    const { url } = await landOn({
      sentState: false,
      appState: { course_key: 'abc' }
    })

    expect(url.search).toBe('')
    expect(url.href).not.toContain('course_key')
  })

  it('sin `appState` el resultado no se inventa uno', async () => {
    const { result } = await landOn({ sentState: false })

    expect(result.appState).toBeUndefined()
  })
})

// ⚠️ La trampa que hace falta que exista el getter: los callbacks de
// onAuthStateChange se ESPERAN (`await sub.callback(...)`), y
// handleRedirectCallback() es el initialize() que los está emitiendo. Quien lo
// llame desde dentro de un listener se queda colgado.
describe('appState desde un listener', () => {
  const setup = async () => {
    h.loc.href = 'https://app.example.com/apply?code=code_abc'
    const storage = inMemoryStorage()
    await saveCodeVerifier(
      storage,
      'faable-auth-token-test-client-code-verifier',
      { verifier: 'verifier_abc', appState: { course_key: 'abc' } }
    )
    net.impl = async (url: string) =>
      url.endsWith('/oauth/token')
        ? { ok: true, status: 200, json: async () => tokenResponse() }
        : { ok: true, status: 200, json: async () => ({ id: 'user_1' }) }

    return new FaableAuthClient({
      domain: 'https://tenant.auth.faable.link',
      clientId: 'test-client',
      storage,
      storageKey: 'faable-auth-token',
      autoRefreshToken: false,
      flowType: 'pkce'
    } as any)
  }

  it('el getter se lee dentro del SIGNED_IN', async () => {
    const auth = await setup()
    let seen: unknown = 'no corrió'

    auth.onAuthStateChange((ev: string) => {
      if (ev === 'SIGNED_IN') seen = auth.appState
    })
    await auth.handleRedirectCallback()

    expect(seen).toEqual({ course_key: 'abc' })
  })

  it('await handleRedirectCallback() dentro del listener NO resuelve', async () => {
    const auth = await setup()
    let seen: unknown = 'no corrió'

    auth.onAuthStateChange(async (ev: string) => {
      if (ev !== 'SIGNED_IN') return
      seen = await Promise.race([
        auth.handleRedirectCallback().then(r => r.appState),
        new Promise(res => setTimeout(() => res('COLGADO'), 200))
      ])
    })
    await Promise.race([
      auth.handleRedirectCallback(),
      new Promise(res => setTimeout(res, 1000))
    ])

    // Si algún día esto deja de ser 'COLGADO', el getter sobra y se puede
    // documentar el camino directo.
    expect(seen).toBe('COLGADO')
  })
})
