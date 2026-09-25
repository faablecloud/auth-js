import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { AuthApiError, AuthRetryableFetchError } from '../../src/lib/errors'
import { _get } from '../../src/lib/fetch'
import type { SupportedStorage } from '../../src/lib/types'

// Intercept the HTTP layer: `api.signOut` GETs `/logout` through `_get`.
vi.mock('../../src/lib/fetch', () => ({
  _get: vi.fn(async () => ({ data: null, error: null })),
  _post: vi.fn(async () => ({ data: null, error: null }))
}))

const mGet = _get as unknown as ReturnType<typeof vi.fn>

const inMemoryStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
}

const SESSION_KEY = 'faableauth-test-client'

const seededClient = (extra: Record<string, unknown> = {}) => {
  const storage = inMemoryStorage()
  storage.setItem(
    SESSION_KEY,
    JSON.stringify({
      access_token: 'at_test',
      refresh_token: 'rt_test',
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user_test' },
      ...extra
    })
  )
  const auth = createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage
  })
  return { auth, storage }
}

beforeEach(() => {
  mGet.mockReset()
  mGet.mockResolvedValue({ data: null, error: null })
})

// The non-redirect sign-out revokes server-side tokens best-effort. Whatever
// that call returns, the local session must be gone afterwards — a
// CORS-blocked /logout (the norm cross-site) must never leave the user
// visibly signed in.
describe('signOut({ redirect: false }) local teardown', () => {
  it('clears the local session when the revoke call fails at network level (CORS)', async () => {
    const { auth, storage } = seededClient()
    mGet.mockResolvedValue({
      data: null,
      error: new AuthRetryableFetchError('Failed to fetch', 0)
    })

    const { error } = await auth.signOut({ redirect: false })

    expect(error).toBeNull()
    expect(await storage.getItem(SESSION_KEY)).toBeNull()
  })

  it('clears the local session and surfaces a real API rejection', async () => {
    const { auth, storage } = seededClient()
    mGet.mockResolvedValue({
      data: null,
      error: new AuthApiError('boom', 500, undefined)
    })

    const { error } = await auth.signOut({ redirect: false })

    expect(error).toBeInstanceOf(AuthApiError)
    expect(await storage.getItem(SESSION_KEY)).toBeNull()
  })

  it('ignores 401s — an invalid JWT should still sign out locally', async () => {
    const { auth, storage } = seededClient()
    mGet.mockResolvedValue({
      data: null,
      error: new AuthApiError('unauthorized', 401, undefined)
    })

    const { error } = await auth.signOut({ redirect: false })

    expect(error).toBeNull()
    expect(await storage.getItem(SESSION_KEY)).toBeNull()
  })

  // Backlog §241 step 17: the tenant can only skip the /logout confirmation
  // screen (`Account.logout_confirm_required`) when it gets a VERIFIED
  // id_token_hint. The redirect path already sends it (getLogoutUrl); this
  // is the same hint on the fetch-only path this suite covers.
  it('sends the session id_token as id_token_hint on the /logout GET', async () => {
    const { auth } = seededClient({ id_token: 'the.id.token' })

    await auth.signOut({ redirect: false })

    expect(mGet).toHaveBeenCalledTimes(1)
    const [url] = mGet.mock.calls[0]
    expect(new URL(url).searchParams.get('id_token_hint')).toBe('the.id.token')
  })

  it('omits id_token_hint when the session has no id_token (e.g. a password grant)', async () => {
    const { auth } = seededClient()

    await auth.signOut({ redirect: false })

    const [url] = mGet.mock.calls[0]
    expect(new URL(url).searchParams.has('id_token_hint')).toBe(false)
  })
})
