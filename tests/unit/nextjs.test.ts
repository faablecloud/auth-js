import {
  type JWK,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair
} from 'jose'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FaableAuthNext, createFaableAuth } from '../../src/nextjs/client'
import {
  MAX_CHUNK_SIZE,
  jarFromMap,
  parseCookieHeader,
  readChunked,
  writeChunked
} from '../../src/nextjs/cookies'
import { BACKCHANNEL_LOGOUT_EVENT } from '../../src/nextjs/oidc'

// Backlog §241 — `@faable/auth-js/nextjs`: HttpOnly encrypted cookie, tokens
// verified against the JWKS, and a back-channel receiver that ends the
// session. The tenant here is a local key pair; the token endpoint a fake.

const ISSUER = 'https://tenant.auth.faable.link'
const CLIENT_ID = 'client_app'
const BASE_URL = 'https://app.example.com'
const SECRET = 'a-secret-of-at-least-thirty-two-characters-long'

let privateKey: CryptoKey
let jwks: ReturnType<typeof createLocalJWKSet>
let otherPrivateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey as CryptoKey
  const jwk: JWK = {
    ...(await exportJWK(pair.publicKey)),
    kid: 'k1',
    alg: 'RS256',
    use: 'sig'
  }
  jwks = createLocalJWKSet({ keys: [jwk] })
  const other = await generateKeyPair('RS256')
  otherPrivateKey = other.privateKey as CryptoKey
})

const now = () => Math.floor(Date.now() / 1000)

const idToken = (
  claims: Record<string, unknown>,
  key: CryptoKey = privateKey
) =>
  new SignJWT({ email: 'ana@example.com', name: 'Ana', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setSubject('user_1')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)

const logoutToken = (
  claims: Record<string, unknown>,
  opts: { key?: CryptoKey; typ?: string; aud?: string } = {}
) =>
  new SignJWT({ events: { [BACKCHANNEL_LOGOUT_EVENT]: {} }, ...claims })
    .setProtectedHeader({
      alg: 'RS256',
      kid: 'k1',
      typ: opts.typ ?? 'logout+jwt'
    })
    .setIssuer(ISSUER)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setSubject('user_1')
    .setIssuedAt()
    .setJti('jti-1')
    .setExpirationTime('2m')
    .sign(opts.key ?? privateKey)

// The fake token endpoint. Each test decides what it answers.
let tokenEndpoint: (body: any) => Promise<{ status: number; body: any }>
const tokenCalls: any[] = []
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input)
  if (!url.endsWith('/oauth/token')) throw new Error(`unexpected fetch ${url}`)
  const body = JSON.parse(String(init?.body))
  tokenCalls.push(body)
  const { status, body: out } = await tokenEndpoint(body)
  return new Response(JSON.stringify(out), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

const auth = (
  extra: Partial<ConstructorParameters<typeof FaableAuthNext>[0]> = {}
) =>
  new FaableAuthNext({
    domain: ISSUER,
    clientId: CLIENT_ID,
    secret: SECRET,
    baseUrl: BASE_URL,
    jwks,
    fetch: fakeFetch,
    ...extra
  })

const setCookies = (res: Response): string[] => res.headers.getSetCookie()
/** What the browser would send back after `Set-Cookie`s: live pairs only. */
const cookieHeaderFrom = (...responses: Response[]): string => {
  const jar = new Map<string, string>()
  for (const res of responses) {
    for (const c of setCookies(res)) {
      const [pair, ...attrs] = c.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      const expired = attrs.some(a => a.trim().toLowerCase() === 'max-age=0')
      if (expired || value === '') jar.delete(name)
      else jar.set(name, value)
    }
  }
  return Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ')
}

/** Runs login → callback for a fresh session and returns the browser's cookie header. */
const login = async (a: FaableAuthNext, returnTo = '/dashboard') => {
  const loginRes = await a.handleRequest(
    new Request(
      `${BASE_URL}/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    )
  )
  expect(loginRes.status).toBe(302)
  const authorize = new URL(loginRes.headers.get('location')!)
  const state = authorize.searchParams.get('state')!
  const nonce = authorize.searchParams.get('nonce')!

  tokenEndpoint = async () => ({
    status: 200,
    body: {
      access_token: 'at_1',
      refresh_token: 'rt_1',
      id_token: await idToken({ nonce, sid: 'sid_1' }),
      expires_in: 3600,
      token_type: 'Bearer'
    }
  })
  const cbRes = await a.handleRequest(
    new Request(`${BASE_URL}/auth/callback?code=code_1&state=${state}`, {
      headers: { cookie: cookieHeaderFrom(loginRes) }
    })
  )
  return {
    loginRes,
    authorize,
    cbRes,
    cookie: cookieHeaderFrom(loginRes, cbRes)
  }
}

beforeEach(() => {
  tokenCalls.length = 0
  tokenEndpoint = async () => ({ status: 500, body: {} })
})

describe('login', () => {
  it('redirects to /authorize with PKCE S256, state and nonce, and sets an HttpOnly transaction cookie', async () => {
    const a = auth()
    const res = await a.handleRequest(
      new Request(`${BASE_URL}/auth/login?returnTo=/x&connection=google`)
    )
    expect(res.status).toBe(302)
    const u = new URL(res.headers.get('location')!)
    expect(`${u.origin}${u.pathname}`).toBe(`${ISSUER}/authorize`)
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('redirect_uri')).toBe(`${BASE_URL}/auth/callback`)
    expect(u.searchParams.get('scope')).toBe('openid profile email')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(u.searchParams.get('state')).toBeTruthy()
    expect(u.searchParams.get('nonce')).toBeTruthy()
    expect(u.searchParams.get('connection')).toBe('google')
    const tx = setCookies(res).find(c => c.startsWith('faable_session_tx='))!
    expect(tx).toMatch(/HttpOnly/)
    expect(tx).toMatch(/Secure/)
    expect(tx).toMatch(/SameSite=Lax/)
    expect(tx).toMatch(/Max-Age=600/)
  })
})

describe('callback', () => {
  it('exchanges the code with the verifier, verifies the id_token and sets the session cookie', async () => {
    const a = auth()
    const { cbRes, cookie, authorize } = await login(a)
    expect(cbRes.status).toBe(302)
    expect(cbRes.headers.get('location')).toBe(`${BASE_URL}/dashboard`)

    expect(tokenCalls[0].grant_type).toBe('authorization_code')
    expect(tokenCalls[0].code).toBe('code_1')
    expect(tokenCalls[0].redirect_uri).toBe(`${BASE_URL}/auth/callback`)
    expect(tokenCalls[0].code_verifier).toBeTruthy()
    // The verifier is the one whose S256 went out in the authorize URL.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(tokenCalls[0].code_verifier)
    )
    const challenge = Buffer.from(digest).toString('base64url')
    expect(authorize.searchParams.get('code_challenge')).toBe(challenge)

    const session = setCookies(cbRes).find(c =>
      c.startsWith('faable_session=')
    )!
    expect(session).toMatch(/HttpOnly/)
    // Opaque: no token in clear.
    expect(session).not.toContain('at_1')
    expect(session).not.toContain('rt_1')
    // The transaction cookie is gone.
    expect(
      setCookies(cbRes).some(
        c => c.startsWith('faable_session_tx=') && /Max-Age=0/.test(c)
      )
    ).toBe(true)

    const s = await a.getSession(
      new Request(`${BASE_URL}/`, { headers: { cookie } })
    )
    expect(s?.user.sub).toBe('user_1')
    expect(s?.user.email).toBe('ana@example.com')
    expect(s?.accessToken).toBe('at_1')
    expect(s?.sid).toBe('sid_1')
    // Token-describing claims do not leak into `user`.
    expect(s?.user.aud).toBeUndefined()
    expect(s?.user.nonce).toBeUndefined()
  })

  it('refuses a state that did not start here', async () => {
    const a = auth()
    const res = await a.handleRequest(
      new Request(`${BASE_URL}/auth/callback?code=c&state=forged`)
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_state')
  })

  it('refuses an id_token signed by another key', async () => {
    const a = auth()
    const loginRes = await a.handleRequest(
      new Request(`${BASE_URL}/auth/login`)
    )
    const u = new URL(loginRes.headers.get('location')!)
    tokenEndpoint = async () => ({
      status: 200,
      body: {
        access_token: 'at',
        id_token: await idToken(
          { nonce: u.searchParams.get('nonce') },
          otherPrivateKey
        ),
        expires_in: 3600
      }
    })
    const res = await a.handleRequest(
      new Request(
        `${BASE_URL}/auth/callback?code=c&state=${u.searchParams.get('state')}`,
        {
          headers: { cookie: cookieHeaderFrom(loginRes) }
        }
      )
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_id_token')
  })

  it('refuses an id_token with the wrong nonce', async () => {
    const a = auth()
    const loginRes = await a.handleRequest(
      new Request(`${BASE_URL}/auth/login`)
    )
    const u = new URL(loginRes.headers.get('location')!)
    tokenEndpoint = async () => ({
      status: 200,
      body: {
        access_token: 'at',
        id_token: await idToken({ nonce: 'other' }),
        expires_in: 3600
      }
    })
    const res = await a.handleRequest(
      new Request(
        `${BASE_URL}/auth/callback?code=c&state=${u.searchParams.get('state')}`,
        {
          headers: { cookie: cookieHeaderFrom(loginRes) }
        }
      )
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error_description).toMatch(/nonce/)
  })

  it('surfaces a server error redirect as 400 and drops the transaction', async () => {
    const a = auth()
    const res = await a.handleRequest(
      new Request(
        `${BASE_URL}/auth/callback?error=access_denied&error_description=nope`
      )
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'access_denied',
      error_description: 'nope'
    })
  })

  it('never redirects off-origin: returnTo is a path of this app', async () => {
    const a = auth()
    expect(a.safeReturnTo('https://evil.example.com/')).toBe('/')
    expect(a.safeReturnTo('//evil.example.com/')).toBe('/')
    expect(a.safeReturnTo('/dashboard?tab=1')).toBe('/dashboard?tab=1')
    expect(a.safeReturnTo(`${BASE_URL}/deep/link#x`)).toBe('/deep/link#x')
    expect(a.safeReturnTo(null)).toBe('/')
  })
})

describe('getSession', () => {
  it('a tampered cookie is not a session', async () => {
    const a = auth()
    const { cookie } = await login(a)
    const tampered = cookie.replace(
      /faable_session=([^;]+)/,
      (_m, v) => `faable_session=${v.slice(0, -4)}AAAA`
    )
    expect(
      await a.getSession(
        new Request(`${BASE_URL}/`, { headers: { cookie: tampered } })
      )
    ).toBeNull()
    const forged =
      'faable_session=' +
      Buffer.from(JSON.stringify({ user: { sub: 'admin' } })).toString(
        'base64url'
      )
    expect(
      await a.getSession(
        new Request(`${BASE_URL}/`, { headers: { cookie: forged } })
      )
    ).toBeNull()
  })

  it('a cookie sealed with another secret is not a session', async () => {
    const a = auth()
    const { cookie } = await login(a)
    const b = auth({ secret: 'another-secret-of-at-least-thirty-two-chars' })
    expect(
      await b.getSession(new Request(`${BASE_URL}/`, { headers: { cookie } }))
    ).toBeNull()
  })

  it('reads from a cookie jar too (cookies() / req.cookies shape)', async () => {
    const a = auth()
    const { cookie } = await login(a)
    const jar = jarFromMap(parseCookieHeader(cookie))
    expect((await a.getSession(jar))?.user.sub).toBe('user_1')
  })
})

describe('back-channel logout', () => {
  it('a verified logout_token ends the session with that sid', async () => {
    const a = auth()
    const { cookie } = await login(a)
    const req = () => new Request(`${BASE_URL}/`, { headers: { cookie } })
    expect((await a.getSession(req()))?.sid).toBe('sid_1')

    const res = await a.handleRequest(
      new Request(`${BASE_URL}/auth/backchannel-logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          logout_token: await logoutToken({ sid: 'sid_1' })
        })
      })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    // The browser still sends the cookie; it is worth nothing now.
    expect(await a.getSession(req())).toBeNull()
    expect(await a.getAccessToken(req())).toBeNull()
  })

  it('a logout_token without sid ends every session of sub that existed', async () => {
    const a = auth()
    const { cookie } = await login(a)
    const res = await a.handleRequest(
      new Request(`${BASE_URL}/auth/backchannel-logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: await logoutToken({}) })
      })
    )
    expect(res.status).toBe(200)
    expect(
      await a.getSession(new Request(`${BASE_URL}/`, { headers: { cookie } }))
    ).toBeNull()
  })

  it.each([
    ['another key', () => logoutToken({ sid: 's' }, { key: otherPrivateKey })],
    [
      'another audience',
      () => logoutToken({ sid: 's' }, { aud: 'client_other' })
    ],
    ['a nonce', () => logoutToken({ sid: 's', nonce: 'n' })],
    [
      'no events claim',
      () =>
        new SignJWT({ sid: 's' })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(ISSUER)
          .setAudience(CLIENT_ID)
          .setSubject('user_1')
          .setIssuedAt()
          .setExpirationTime('2m')
          .sign(privateKey)
    ],
    ['a wrong typ', () => logoutToken({ sid: 's' }, { typ: 'JWT' })],
    [
      'neither sid nor sub',
      () =>
        new SignJWT({ events: { [BACKCHANNEL_LOGOUT_EVENT]: {} } })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'logout+jwt' })
          .setIssuer(ISSUER)
          .setAudience(CLIENT_ID)
          .setIssuedAt()
          .setExpirationTime('2m')
          .sign(privateKey)
    ]
  ])('rejects a logout_token with %s', async (_label, mint) => {
    const a = auth()
    const res = await a.handleRequest(
      new Request(`${BASE_URL}/auth/backchannel-logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: await mint() })
      })
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })

  it('a stale logout_token (iat too old) is rejected', async () => {
    const a = auth()
    const stale = await new SignJWT({
      events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
      sid: 's'
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'logout+jwt' })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject('user_1')
      .setIssuedAt(now() - 3600)
      .setExpirationTime(now() + 60)
      .sign(privateKey)
    const res = await a.handleRequest(
      new Request(`${BASE_URL}/auth/backchannel-logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ logout_token: stale })
      })
    )
    expect(res.status).toBe(400)
  })
})

describe('getAccessToken', () => {
  it('returns the current token while it is live, without touching the server', async () => {
    const a = auth()
    const { cookie } = await login(a)
    tokenCalls.length = 0
    const r = await a.getAccessToken(
      new Request(`${BASE_URL}/`, { headers: { cookie } })
    )
    expect(r?.accessToken).toBe('at_1')
    expect(r?.setCookie).toEqual([])
    expect(tokenCalls.length).toBe(0)
  })

  it('refreshes an expiring token and hands back the cookies to persist', async () => {
    const a = auth()
    const loginRes = await a.handleRequest(
      new Request(`${BASE_URL}/auth/login`)
    )
    const u = new URL(loginRes.headers.get('location')!)
    tokenEndpoint = async () => ({
      status: 200,
      body: {
        access_token: 'at_short',
        refresh_token: 'rt_1',
        id_token: await idToken({
          nonce: u.searchParams.get('nonce'),
          sid: 'sid_1'
        }),
        expires_in: 5 // within the refresh skew
      }
    })
    const cbRes = await a.handleRequest(
      new Request(
        `${BASE_URL}/auth/callback?code=c&state=${u.searchParams.get('state')}`,
        {
          headers: { cookie: cookieHeaderFrom(loginRes) }
        }
      )
    )
    const cookie = cookieHeaderFrom(loginRes, cbRes)

    tokenEndpoint = async body => {
      expect(body.grant_type).toBe('refresh_token')
      expect(body.refresh_token).toBe('rt_1')
      return {
        status: 200,
        body: { access_token: 'at_2', refresh_token: 'rt_2', expires_in: 3600 }
      }
    }
    const r = await a.getAccessToken(
      new Request(`${BASE_URL}/`, { headers: { cookie } })
    )
    expect(r?.accessToken).toBe('at_2')
    expect(r!.setCookie.length).toBeGreaterThan(0)

    // The refreshed cookie carries the rotated refresh token.
    const after = cookieHeaderFrom(
      loginRes,
      cbRes,
      new Response(null, {
        headers: r!.setCookie.map(c => ['set-cookie', c] as [string, string])
      })
    )
    const s = await a.getSession(
      new Request(`${BASE_URL}/`, { headers: { cookie: after } })
    )
    expect(s?.refreshToken).toBe('rt_2')
    expect(s?.accessToken).toBe('at_2')
  })

  it('an invalid_grant on refresh means no session', async () => {
    const a = auth()
    const loginRes = await a.handleRequest(
      new Request(`${BASE_URL}/auth/login`)
    )
    const u = new URL(loginRes.headers.get('location')!)
    tokenEndpoint = async () => ({
      status: 200,
      body: {
        access_token: 'at',
        refresh_token: 'rt',
        id_token: await idToken({ nonce: u.searchParams.get('nonce') }),
        expires_in: 0
      }
    })
    const cbRes = await a.handleRequest(
      new Request(
        `${BASE_URL}/auth/callback?code=c&state=${u.searchParams.get('state')}`,
        {
          headers: { cookie: cookieHeaderFrom(loginRes) }
        }
      )
    )
    tokenEndpoint = async () => ({
      status: 400,
      body: { error: 'invalid_grant' }
    })
    const r = await a.getAccessToken(
      new Request(`${BASE_URL}/`, {
        headers: { cookie: cookieHeaderFrom(loginRes, cbRes) }
      })
    )
    expect(r).toBeNull()
  })
})

describe('logout', () => {
  it('clears the cookie and sends the browser through the tenant /logout with id_token_hint', async () => {
    const a = auth()
    const { cookie } = await login(a)
    const res = await a.handleRequest(
      new Request(`${BASE_URL}/auth/logout?returnTo=/bye`, {
        headers: { cookie }
      })
    )
    expect(res.status).toBe(302)
    const u = new URL(res.headers.get('location')!)
    expect(`${u.origin}${u.pathname}`).toBe(`${ISSUER}/logout`)
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe(
      `${BASE_URL}/bye`
    )
    expect(u.searchParams.get('id_token_hint')).toMatch(/^eyJ/)
    expect(
      setCookies(res).some(
        c => c.startsWith('faable_session=') && /Max-Age=0/.test(c)
      )
    ).toBe(true)
  })
})

describe('cookies', () => {
  it('chunks a long value and reads it back; a shorter rewrite clears stale chunks', () => {
    const long = 'x'.repeat(MAX_CHUNK_SIZE * 2 + 10)
    const written = writeChunked('s', long, { path: '/' })
    expect(written.map(c => c.split('=')[0])).toEqual(['s.0', 's.1', 's.2'])
    const jar = jarFromMap(
      parseCookieHeader(written.map(c => c.split(';')[0]).join('; '))
    )
    expect(readChunked(jar, 's')).toBe(long)

    const again = writeChunked('s', 'short', { path: '/' }, [
      's.0',
      's.1',
      's.2'
    ])
    expect(again[0]).toMatch(/^s=short/)
    expect(
      again.filter(c => /Max-Age=0/.test(c)).map(c => c.split('=')[0])
    ).toEqual(['s.0', 's.1', 's.2'])
  })

  it('createFaableAuth refuses a short secret and a missing config', () => {
    expect(() =>
      createFaableAuth({
        domain: ISSUER,
        clientId: 'c',
        secret: 'short',
        baseUrl: BASE_URL
      })
    ).toThrow(/32 characters/)
    expect(() =>
      createFaableAuth({ domain: ISSUER, clientId: 'c', secret: SECRET })
    ).toThrow(/baseUrl/)
  })
})
