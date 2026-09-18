import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FaableAuthClient } from '../../src/FaableAuthClient'
import { loadCodeVerifier } from '../../src/lib/pkce_storage'
import type { SupportedStorage } from '../../src/lib/types'

// La ida. La vuelta está en callbackStateCleanup.test.ts.
//
// Lo que se afirma aquí es lo que distingue `appState` de meter los datos en
// `queryParams.state`: que NO viajan. Ni en la URL de /authorize, ni por tanto
// al servidor, ni al historial del navegador.

const h = vi.hoisted(() => {
  const loc = {
    href: 'https://app.example.com/apply',
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

const start = async (appState?: unknown) => {
  const storage = inMemoryStorage()
  const auth = new FaableAuthClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage,
    storageKey: 'faable-auth-token',
    autoRefreshToken: false,
    flowType: 'pkce'
  } as any)

  const { data } = await auth.signInWithOauthConnection({
    connection_id: 'connection_db',
    skipBrowserRedirect: true,
    ...(appState !== undefined ? { appState } : {})
  })

  return {
    url: new URL(data!.url!),
    stored: await loadCodeVerifier(
      storage,
      'faable-auth-token-test-client-code-verifier'
    )
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
})

describe('appState en la ida', () => {
  it('se guarda junto al verifier de PKCE', async () => {
    const { stored } = await start({ course_key: 'abc' })

    expect(stored?.appState).toEqual({ course_key: 'abc' })
  })

  it('NO viaja en la URL de /authorize', async () => {
    const { url } = await start({ course_key: 'abc' })

    expect(url.searchParams.get('appState')).toBeNull()
    // Ni disfrazado de `state`: ese parámetro es del protocolo.
    expect(url.searchParams.get('state')).toBeNull()
    expect(url.href).not.toContain('course_key')
  })

  it('no toca el `state` de quien sí lo use', async () => {
    const storage = inMemoryStorage()
    const auth = new FaableAuthClient({
      domain: 'https://tenant.auth.faable.link',
      clientId: 'test-client',
      storage,
      storageKey: 'faable-auth-token',
      autoRefreshToken: false,
      flowType: 'pkce'
    } as any)

    const { data } = await auth.signInWithOauthConnection({
      connection_id: 'connection_db',
      skipBrowserRedirect: true,
      queryParams: { state: 'mi-state' },
      appState: { course_key: 'abc' }
    })

    const url = new URL(data!.url!)
    expect(url.searchParams.get('state')).toBe('mi-state')
    const stored = await loadCodeVerifier(
      storage,
      'faable-auth-token-test-client-code-verifier'
    )
    // Las dos cosas conviven: el `state` es suyo y lo leerá de la URL, y el
    // appState vuelve por el SDK.
    expect(stored?.sentState).toBe(true)
    expect(stored?.appState).toEqual({ course_key: 'abc' })
  })
})
