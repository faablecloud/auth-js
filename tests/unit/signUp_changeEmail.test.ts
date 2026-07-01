import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { _post } from '../../src/lib/fetch'
import type { SupportedStorage } from '../../src/lib/types'

// Intercept the HTTP layer so we can assert what the client sends and drive
// server responses without a network. `_get` gets a benign default so the
// constructor's initialize() path never throws.
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

const baseConfig = () => ({
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  storage: inMemoryStorage(),
  autoRefreshToken: false as const
})

beforeEach(() => {
  mPost.mockReset()
  mPost.mockResolvedValue({ data: null, error: null })
})

describe('signUp', () => {
  it('validates that email and password are present', async () => {
    const auth = createClient(baseConfig())
    const { error } = await auth.signUp({ email: '', password: '' } as any)
    expect(error).toBeTruthy()
    expect(error?.message).toContain('required')
    // Never touched the network.
    expect(
      mPost.mock.calls.some(c => String(c[0]).includes('/dbconnections/signup'))
    ).toBe(false)
  })

  it('maps a 403 from the signup endpoint to a signup_disabled error', async () => {
    const auth = createClient(baseConfig())
    mPost.mockImplementation(async (url: string) =>
      url.endsWith('/dbconnections/signup')
        ? {
            data: { status: 403, message: 'signup_disabled' },
            error: 'signup_disabled'
          }
        : { data: null, error: null }
    )

    const { error } = await auth.signUp({
      email: 'user@example.com',
      password: 'BrandN3wPass'
    })
    expect(error?.code).toBe('signup_disabled')
    expect(error?.status).toBe(403)
  })

  it('maps a 409 from the signup endpoint to an email_exists error', async () => {
    const auth = createClient(baseConfig())
    mPost.mockImplementation(async (url: string) =>
      url.endsWith('/dbconnections/signup')
        ? {
            data: { status: 409, message: 'email_taken' },
            error: 'email_taken'
          }
        : { data: null, error: null }
    )

    const { error } = await auth.signUp({
      email: 'taken@example.com',
      password: 'BrandN3wPass'
    })
    expect(error?.code).toBe('email_exists')
    expect(error?.status).toBe(409)
  })

  it('on success chains signInWithUsernamePassword (auto-login) with the credentials', async () => {
    const auth = createClient(baseConfig())
    mPost.mockImplementation(async (url: string) =>
      url.endsWith('/dbconnections/signup')
        ? {
            data: {
              status: 'created',
              user_id: 'user_1',
              email_verified: false
            },
            error: null
          }
        : { data: null, error: null }
    )
    const loginSpy = vi
      .spyOn(auth, 'signInWithUsernamePassword')
      .mockResolvedValue({ data: null, error: null })

    const { error } = await auth.signUp({
      email: 'user@example.com',
      password: 'BrandN3wPass',
      redirectTo: 'https://app.example.com/callback'
    })

    expect(error).toBeNull()
    expect(loginSpy).toHaveBeenCalledWith({
      username: 'user@example.com',
      password: 'BrandN3wPass',
      redirectTo: 'https://app.example.com/callback',
      state: undefined,
      audience: undefined
    })
    // The signup POST carried the client_id and profile fields.
    const signupCall = mPost.mock.calls.find(c =>
      String(c[0]).endsWith('/dbconnections/signup')
    )
    expect(signupCall?.[1]).toMatchObject({
      client_id: 'test-client',
      email: 'user@example.com',
      password: 'BrandN3wPass'
    })
  })
})

describe('changeEmail', () => {
  it('requires a new_email', async () => {
    const auth = createClient(baseConfig())
    const { error } = await auth.changeEmail({ new_email: '' } as any)
    expect(error).toBeTruthy()
  })

  it('fails when there is no active session', async () => {
    const auth = createClient(baseConfig())
    vi.spyOn(auth, 'getSession').mockResolvedValue({
      data: { session: null },
      error: null
    } as any)

    const { error } = await auth.changeEmail({ new_email: 'new@example.com' })
    expect(error).toBeTruthy()
  })

  // Regression: `/me` (userinfo) exposes the user id as `user.id`, NOT
  // `user.sub`. changeEmail 1.9.0 read only `.sub`, so a valid session was
  // misreported as AuthSessionMissingError ("Auth session missing!").
  it('resolves the user id from the userinfo `user.id` shape (not `sub`)', async () => {
    const auth = createClient(baseConfig())
    vi.spyOn(auth, 'getSession').mockResolvedValue({
      data: {
        // No `sub` here on purpose — this is the real /me shape.
        session: { access_token: 'tok-123', user: { id: 'user_123' } }
      },
      error: null
    } as any)
    mPost.mockImplementation(async (url: string) =>
      url.includes('/change-email')
        ? {
            data: { status: 'verification_sent', ticket_id: 'tkt_1' },
            error: null
          }
        : { data: null, error: null }
    )

    const { data, error } = await auth.changeEmail({
      new_email: 'new@example.com',
      verification_mode: 'old_and_new',
      redirect_uri: 'https://app.example.com/account'
    })

    expect(error).toBeNull()
    expect((data as any).status).toBe('verification_sent')

    const call = mPost.mock.calls.find(c =>
      String(c[0]).includes('/change-email')
    )
    expect(call?.[0]).toBe(
      'https://tenant.auth.faable.link/user/user_123/change-email'
    )
    expect(call?.[1]).toMatchObject({
      new_email: 'new@example.com',
      verification_mode: 'old_and_new',
      redirect_uri: 'https://app.example.com/account'
    })
    expect(call?.[2]).toMatchObject({ token: 'tok-123' })
  })

  it('falls back to the access token `sub` claim when the user object has no id', async () => {
    const b64url = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url')
    const accessToken = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
      sub: 'user_jwt'
    })}.sig`

    const auth = createClient(baseConfig())
    vi.spyOn(auth, 'getSession').mockResolvedValue({
      // user object carries neither `id` nor `sub` — only the JWT does.
      data: { session: { access_token: accessToken, user: {} } },
      error: null
    } as any)
    mPost.mockImplementation(async (url: string) =>
      url.includes('/change-email')
        ? { data: { status: 'verification_sent' }, error: null }
        : { data: null, error: null }
    )

    const { error } = await auth.changeEmail({ new_email: 'new@example.com' })
    expect(error).toBeNull()

    const call = mPost.mock.calls.find(c =>
      String(c[0]).includes('/change-email')
    )
    expect(call?.[0]).toBe(
      'https://tenant.auth.faable.link/user/user_jwt/change-email'
    )
  })
})
