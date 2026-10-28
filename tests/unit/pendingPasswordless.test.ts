import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { PENDING_PASSWORDLESS_TTL_MS } from '../../src/lib/pending_passwordless'
import type { SupportedStorage } from '../../src/lib/types'

// The emailed code a browser is waiting for lives in the SDK, and so does
// forgetting it. When the dashboard kept its own copy it forgot to clear it on
// the path where the sign-in navigates away, and after a logout the login
// screen came back to "We've sent a 6 digit code" for a code already spent
// (Kirbic, 2026-10-28).

const h = vi.hoisted(() => {
  const loc = {
    href: 'https://app.example.com/login',
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

const EMAIL = 'someone@example.com'

const memoryStorage = () => {
  const store = new Map<string, string>()
  const storage: SupportedStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
  return storage
}

const client = (storage: SupportedStorage) =>
  createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage,
    autoRefreshToken: false
  })

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body
})

// passwordless/start, the OTP grant and /me, as the server answers them.
const serverAnswers = async (url: string) => {
  if (url.endsWith('/passwordless/start'))
    return json({ email: EMAIL, email_verified: false })
  if (url.includes('/oauth/token'))
    return json({
      access_token: 'at_1',
      refresh_token: 'rt_1',
      expires_in: 3600,
      token_type: 'bearer'
    })
  if (url.endsWith('/me')) return json({ sub: 'user_1', email: EMAIL })
  return json({})
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal('document', {})
  net.calls.length = 0
  net.impl = serverAnswers
})

describe('pending passwordless code', () => {
  it('a sent code is remembered, with its appState, and the start carries auth_params and resume_url', async () => {
    const auth = client(memoryStorage())
    const { error } = await auth.signInWithPasswordless({
      email: EMAIL,
      type: 'code',
      authParams: { name: 'Ada' },
      resumeUrl: 'https://app.example.com/login#resume',
      appState: { screen: 'signup' }
    })
    expect(error).toBeNull()

    const start = net.calls.find(c => c.url.endsWith('/passwordless/start'))
    const body = JSON.parse(start!.init.body)
    expect(body.auth_params).toEqual({ name: 'Ada' })
    expect(body.resume_url).toBe('https://app.example.com/login#resume')
    // appState never leaves the browser.
    expect(body.appState).toBeUndefined()

    const pending = await auth.getPendingPasswordless()
    expect(pending?.email).toBe(EMAIL)
    expect(pending?.appState).toEqual({ screen: 'signup' })
    expect(typeof pending?.sent_at).toBe('number')
  })

  it('is not remembered for a magic link, nor when the start fails', async () => {
    const auth = client(memoryStorage())
    await auth.signInWithPasswordless({ email: EMAIL, type: 'link' })
    expect(await auth.getPendingPasswordless()).toBeNull()

    net.impl = async () => json({ message: 'nope' }, 400)
    await auth.signInWithPasswordless({ email: EMAIL, type: 'code' })
    expect(await auth.getPendingPasswordless()).toBeNull()
  })

  it('is forgotten when the code is spent', async () => {
    const auth = client(memoryStorage())
    await auth.signInWithPasswordless({ email: EMAIL, type: 'code' })
    expect(await auth.getPendingPasswordless()).not.toBeNull()

    const { error } = await auth.signInWithOtp({ username: EMAIL, otp: '1' })
    expect(error).toBeNull()
    expect(await auth.getPendingPasswordless()).toBeNull()
  })

  it('is forgotten on sign-out', async () => {
    const auth = client(memoryStorage())
    await auth.signInWithOtp({ username: EMAIL, otp: '1' })
    // A code asked for afterwards in this browser, e.g. by another tab.
    await auth.resumePasswordless({ email: EMAIL, sent_at: Date.now() })
    expect(await auth.getPendingPasswordless()).not.toBeNull()

    await auth.signOut({ scope: 'local' })
    expect(await auth.getPendingPasswordless()).toBeNull()
  })

  it('expires', async () => {
    const auth = client(memoryStorage())
    await auth.resumePasswordless({ email: EMAIL, sent_at: Date.now() })
    const later = Date.now() + PENDING_PASSWORDLESS_TTL_MS + 1
    vi.spyOn(Date, 'now').mockReturnValue(later)
    expect(await auth.getPendingPasswordless()).toBeNull()
  })
})

export {}
