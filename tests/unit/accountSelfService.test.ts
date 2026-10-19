import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { STORAGE_KEY } from '../../src/lib/constants'
import type { SupportedStorage } from '../../src/lib/types'

// Self-service account: getCredentials / setPassword / updateProfile /
// listSessions / unlinkIdentity / deleteAccount call the /me routes with the
// session's access token, surface the server's error_code as a typed
// AuthApiError, and send nothing without a session.

const h = vi.hoisted(() => {
  const loc = {
    href: 'https://app.example.com/area',
    origin: 'https://app.example.com',
    assign: (_url: string) => {}
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

const net = vi.hoisted(() => ({
  calls: [] as { url: string; init: any }[],
  impl: async (_url: string, _init: any): Promise<any> => ({
    ok: true,
    status: 200,
    json: async () => ({})
  })
}))

vi.mock('../../src/lib/globals', () => ({
  window: h.fakeWindow,
  document: {},
  fetch: async (url: string, init: any) => {
    net.calls.push({ url, init })
    return net.impl(url, init)
  }
}))

const CLIENT_ID = 'test-client'

const storageWithSession = () => {
  const store = new Map<string, string>()
  const storage: SupportedStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
  storage.setItem(
    `${STORAGE_KEY}-${CLIENT_ID}`,
    JSON.stringify({
      access_token: 'at_1',
      refresh_token: 'rt_1',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: { sub: 'user_1' }
    })
  )
  return storage
}

const client = (storage: SupportedStorage) =>
  createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: CLIENT_ID,
    storage,
    autoRefreshToken: false
  })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  net.calls.length = 0
  net.impl = async () => ({ ok: true, status: 200, json: async () => ({}) })
})

const emptyStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
}

const reply = (status: number, body: unknown) => async () => ({
  ok: status < 300,
  status,
  json: async () => body
})

describe('getCredentials', () => {
  it('GETs /me/credentials with the access token', async () => {
    net.impl = reply(200, { has_password: false, connections: [] })
    const { data, error } = await client(storageWithSession()).getCredentials()
    expect(error).toBeNull()
    expect(data).toEqual({ has_password: false, connections: [] })
    const call = net.calls.find(c => c.url.endsWith('/me/credentials'))
    expect(call?.url).toBe('https://tenant.auth.faable.link/me/credentials')
    expect(call?.init.method).toBe('GET')
    expect(call?.init.headers.Authorization).toBe('Bearer at_1')
  })

  it('without a session it sends nothing', async () => {
    const { data, error } = await client(emptyStorage()).getCredentials()
    expect(data).toBeNull()
    expect(error?.name).toBe('AuthSessionMissingError')
    expect(net.calls.some(c => c.url.includes('/me/'))).toBe(false)
  })
})

describe('setPassword', () => {
  it('POSTs /me/password with the password and the current one', async () => {
    net.impl = reply(200, { revoked_sessions: 2 })
    const { data, error } = await client(storageWithSession()).setPassword({
      password: 'New-Pass-1',
      current_password: 'Old-Pass-1'
    })
    expect(error).toBeNull()
    expect(data).toEqual({ revoked_sessions: 2 })
    const call = net.calls.find(c => c.url.endsWith('/me/password'))
    expect(call?.init.method).toBe('POST')
    expect(call?.init.headers.Authorization).toBe('Bearer at_1')
    expect(JSON.parse(call?.init.body)).toEqual({
      password: 'New-Pass-1',
      current_password: 'Old-Pass-1'
    })
  })

  it('surfaces reauth_required as a typed AuthApiError', async () => {
    net.impl = reply(403, {
      error_code: 'reauth_required',
      error_description: 'Sign in again with max_age=0'
    })
    const { data, error } = await client(storageWithSession()).setPassword({
      password: 'New-Pass-1'
    })
    expect(data).toBeNull()
    expect(error?.name).toBe('AuthApiError')
    expect(error?.status).toBe(403)
    expect(error?.code).toBe('reauth_required')
    expect(error?.message).toBe('Sign in again with max_age=0')
  })

  it('a network failure is retryable, not a verdict', async () => {
    net.impl = async () => {
      throw new TypeError('Failed to fetch')
    }
    const { error } = await client(storageWithSession()).setPassword({
      password: 'New-Pass-1'
    })
    expect(error?.name).toBe('AuthRetryableFetchError')
  })

  it('an empty password is refused before any request', async () => {
    const { error } = await client(storageWithSession()).setPassword({
      password: ''
    })
    expect(error).not.toBeNull()
    expect(net.calls.some(c => c.url.includes('/me/'))).toBe(false)
  })
})

describe('updateProfile', () => {
  it('PATCHes /me with the fields', async () => {
    net.impl = reply(200, { id: 'user_1', user_metadata: {} })
    const fields = [
      { key: 'profile', value: 'teacher' },
      { key: 'old', value: null }
    ]
    const { data, error } = await client(storageWithSession()).updateProfile({
      fields
    })
    expect(error).toBeNull()
    expect(data?.id).toBe('user_1')
    const call = net.calls.find(c => c.url.endsWith('/me'))
    expect(call?.init.method).toBe('PATCH')
    expect(call?.init.headers.Authorization).toBe('Bearer at_1')
    expect(JSON.parse(call?.init.body)).toEqual({ fields })
  })

  it('surfaces invalid_profile_field', async () => {
    net.impl = reply(400, {
      error_code: 'invalid_profile_field',
      message: 'role is not a profile field of this application'
    })
    const { error } = await client(storageWithSession()).updateProfile({
      fields: [{ key: 'role', value: 'admin' }]
    })
    expect(error?.code).toBe('invalid_profile_field')
    expect(error?.status).toBe(400)
  })
})

describe('updateProfile — name, company and country', () => {
  it('sends only the keys given', async () => {
    net.impl = reply(200, { id: 'user_1', country_iso: 'FR' })
    const { error } = await client(storageWithSession()).updateProfile({
      name: 'Ada',
      country_iso: 'FR'
    })
    expect(error).toBeNull()
    const call = net.calls.find(c => c.url.endsWith('/me'))
    expect(call?.init.method).toBe('PATCH')
    expect(JSON.parse(call?.init.body)).toEqual({
      name: 'Ada',
      country_iso: 'FR'
    })
  })

  it('an empty update is refused before any request', async () => {
    const { error } = await client(storageWithSession()).updateProfile({})
    expect(error).not.toBeNull()
    expect(net.calls.some(c => c.url.includes('/me'))).toBe(false)
  })
})

describe('listSessions', () => {
  it('GETs /me/sessions with the access token', async () => {
    const body = {
      results: [{ id: 'session_1', status: 'active' }],
      current_session_id: 'session_1'
    }
    net.impl = reply(200, body)
    const { data, error } = await client(storageWithSession()).listSessions()
    expect(error).toBeNull()
    expect(data).toEqual(body)
    const call = net.calls.find(c => c.url.endsWith('/me/sessions'))
    expect(call?.init.method).toBe('GET')
    expect(call?.init.headers.Authorization).toBe('Bearer at_1')
  })

  it('without a session it sends nothing', async () => {
    const { error } = await client(emptyStorage()).listSessions()
    expect(error?.name).toBe('AuthSessionMissingError')
    expect(net.calls.some(c => c.url.includes('/me/'))).toBe(false)
  })
})

describe('unlinkIdentity', () => {
  it('DELETEs /me/identities/:connection_id', async () => {
    net.impl = reply(200, { unlinked: 1 })
    const { data, error } =
      await client(storageWithSession()).unlinkIdentity('connection_abc')
    expect(error).toBeNull()
    expect(data).toEqual({ unlinked: 1 })
    const call = net.calls.find(c => c.url.includes('/me/identities/'))
    expect(call?.url).toBe(
      'https://tenant.auth.faable.link/me/identities/connection_abc'
    )
    expect(call?.init.method).toBe('DELETE')
    expect(call?.init.headers.Authorization).toBe('Bearer at_1')
  })

  it('surfaces last_sign_in_method', async () => {
    net.impl = reply(409, {
      error_code: 'last_sign_in_method',
      message: 'This is your only way to sign in.'
    })
    const { data, error } =
      await client(storageWithSession()).unlinkIdentity('connection_abc')
    expect(data).toBeNull()
    expect(error?.name).toBe('AuthApiError')
    expect(error?.status).toBe(409)
    expect(error?.code).toBe('last_sign_in_method')
  })

  it('a missing connection id is refused before any request', async () => {
    const { error } = await client(storageWithSession()).unlinkIdentity('')
    expect(error).not.toBeNull()
    expect(net.calls.some(c => c.url.includes('/me/'))).toBe(false)
  })
})

describe('deleteAccount', () => {
  it('DELETEs /me, then removes the local session and emits SIGNED_OUT', async () => {
    net.impl = async () => ({
      ok: true,
      status: 204,
      // A 204 has no body: reading it as JSON would throw.
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      }
    })
    const storage = storageWithSession()
    const auth = client(storage)
    const events: string[] = []
    auth.onAuthStateChange(event => void events.push(event))
    const { error } = await auth.deleteAccount()
    expect(error).toBeNull()
    const call = net.calls.find(c => c.url.endsWith('/me'))
    expect(call?.init.method).toBe('DELETE')
    expect(call?.init.headers.Authorization).toBe('Bearer at_1')
    expect(storage.getItem(`${STORAGE_KEY}-${CLIENT_ID}`)).toBeNull()
    expect(events).toContain('SIGNED_OUT')
  })

  it('a refusal keeps the session', async () => {
    net.impl = reply(403, {
      error_code: 'user_suspended',
      message: 'user is suspended'
    })
    const storage = storageWithSession()
    const { error } = await client(storage).deleteAccount()
    expect(error?.code).toBe('user_suspended')
    expect(storage.getItem(`${STORAGE_KEY}-${CLIENT_ID}`)).not.toBeNull()
  })
})
