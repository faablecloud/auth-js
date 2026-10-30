import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { _post } from '../../src/lib/fetch'
import { loadCodeVerifier } from '../../src/lib/pkce_storage'
import type { SupportedStorage } from '../../src/lib/types'

// OAuth 2.1 (backlog §447): the password login asked for nothing, so the
// server answered with the implicit default — access AND refresh token in the
// redirect URL. With PKCE it asks for a code the SDK then exchanges.

// A browser: the case where the SDK picks the flow itself.
const h = vi.hoisted(() => {
  const fakeWindow: any = {
    location: {
      href: 'https://app.example.com/',
      origin: 'https://app.example.com'
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  return { fakeWindow }
})
vi.mock('../../src/lib/globals', () => ({
  window: h.fakeWindow,
  document: {}
}))

vi.mock('../../src/lib/fetch', () => ({
  _post: vi.fn(),
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

const makeClient = (storage: SupportedStorage, flowType: string) =>
  createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage,
    storageKey: 'faable-auth-token',
    autoRefreshToken: false,
    flowType,
    redirectUri: REDIRECT
  } as any)

// The request is what matters; a failed answer keeps the SDK from trying to
// submit the callback form.
const loginBody = () => {
  const call = mPost.mock.calls.find(c =>
    String(c[0]).endsWith('/usernamepassword/login')
  )
  return call?.[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.stubGlobal('document', {})
  vi.stubGlobal('window', h.fakeWindow)
  h.fakeWindow.location = {
    href: 'https://app.example.com/',
    origin: 'https://app.example.com'
  }
  mPost.mockReset()
  mPost.mockResolvedValue({ data: null, error: 'nope', status: 400 })
})

describe('signInWithUsernamePassword asks for a PKCE-bound code', () => {
  it('sends response_type=code with an S256 challenge and stores its verifier', async () => {
    const storage = inMemoryStorage()
    const auth = makeClient(storage, 'pkce')

    await auth.signInWithUsernamePassword({ username: 'a@b.c', password: 'x' })

    const body = loginBody()
    expect(body.response_type).toBe('code')
    expect(body.code_challenge_method).toBe('S256')
    expect(typeof body.code_challenge).toBe('string')
    expect(body.redirect_uri).toBe(REDIRECT)

    // The verifier the landing exchanges the code with, and the redirect_uri
    // the exchange has to repeat.
    const stored = await loadCodeVerifier(
      storage,
      'faable-auth-token-test-client-code-verifier'
    )
    expect(stored?.verifier).toBeTruthy()
    expect(stored?.redirectUri).toBe(REDIRECT)
  })

  it('with a state, leaves the /authorize challenge and its verifier alone', async () => {
    const storage = inMemoryStorage()
    const auth = makeClient(storage, 'pkce')

    await auth.signInWithUsernamePassword({
      username: 'a@b.c',
      password: 'x',
      state: 'st_1'
    })

    const body = loginBody()
    expect(body.code_challenge).toBeUndefined()
    expect(body.response_type).toBeUndefined()
    expect(
      await loadCodeVerifier(
        storage,
        'faable-auth-token-test-client-code-verifier'
      )
    ).toBeFalsy()
  })

  it('in a browser, flowType implicit still asks for a PKCE code', async () => {
    // So an app keeps signing in the day its tenant enforces OAuth 2.1.
    const auth = makeClient(inMemoryStorage(), 'implicit')
    await auth.signInWithUsernamePassword({ username: 'a@b.c', password: 'x' })
    const body = loginBody()
    expect(body.response_type).toBe('code')
    expect(body.code_challenge_method).toBe('S256')
  })
})

describe('authorize() binds a code with PKCE', () => {
  it('sends an S256 challenge and stores the verifier with the redirect_uri', async () => {
    const storage = inMemoryStorage()
    const auth = makeClient(storage, 'implicit')
    const spy = vi.spyOn(auth, 'buildAuthorizeUrl')

    await auth.authorize({ response_type: 'code', queryParams: { state: 's' } })

    const url = new URL(spy.mock.results.at(-1)!.value as string)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('state')).toBe('s')
    const stored = await loadCodeVerifier(
      storage,
      'faable-auth-token-test-client-code-verifier'
    )
    expect(stored?.verifier).toBeTruthy()
    expect(stored?.redirectUri).toBe(REDIRECT)
    expect(stored?.sentState).toBe(true)
  })

  it('a token request is left as asked', async () => {
    const auth = makeClient(inMemoryStorage(), 'pkce')
    const spy = vi.spyOn(auth, 'buildAuthorizeUrl')
    await auth.authorize({ response_type: 'token' })
    const url = new URL(spy.mock.results.at(-1)!.value as string)
    expect(url.searchParams.has('code_challenge')).toBe(false)
  })
})
