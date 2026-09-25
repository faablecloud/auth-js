import {
  deleteChunked,
  deriveKey,
  existingNames,
  expireCookie,
  jarFromMap,
  parseCookieHeader,
  readChunked,
  seal,
  unseal,
  writeChunked
} from './cookies'
import {
  type JWKS,
  OAuthError,
  exchangeCode,
  issuerFromDomain,
  pkceChallenge,
  randomToken,
  refreshTokens,
  remoteJwks,
  userFromClaims,
  verifyIdToken,
  verifyLogoutToken
} from './oidc'
import { memorySessionStore } from './store'
import type {
  AuthRoutes,
  CookieAttributes,
  CookieJar,
  FaableAuthNextConfig,
  ServerSession,
  ServerUser,
  SessionCookieOptions,
  SessionStore,
  TokenResponse
} from './types'

const DEFAULT_ROUTES: AuthRoutes = {
  login: '/auth/login',
  callback: '/auth/callback',
  logout: '/auth/logout',
  backchannelLogout: '/auth/backchannel-logout'
}

const DEFAULT_SCOPE = 'openid profile email'
// A login has this long to come back from the auth server.
const TX_TTL_SECONDS = 10 * 60
// Refresh this close to expiry so a token handed out is good for a request.
const EXPIRY_SKEW_SECONDS = 30

// `/authorize` parameters a caller may forward on the login route.
const FORWARDED_AUTHORIZE_PARAMS = [
  'connection',
  'connection_id',
  'prompt',
  'login_hint',
  'screen_hint',
  'audience',
  'scope',
  'acr_values',
  'login_methods',
  'ui_locales',
  'max_age'
]

type Transaction = {
  state: string
  nonce: string
  verifier: string
  returnTo: string
}

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] : undefined

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(
      `@faable/auth-js/nextjs: ${name} is required (pass it to createFaableAuth or set the environment variable)`
    )
  }
  return value
}

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers
    }
  })

const redirect = (location: string, setCookies: string[] = []): Response => {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  for (const c of setCookies) headers.append('set-cookie', c)
  return new Response(null, { status: 302, headers })
}

/**
 * Server-side Faable Auth for Next.js: the login round-trip, an `HttpOnly`
 * encrypted session cookie, tokens verified against the tenant JWKS, and the
 * back-channel logout receiver. Create one with {@link createFaableAuth}.
 */
export class FaableAuthNext {
  readonly issuer: string
  readonly clientId: string
  readonly baseUrl: string
  readonly routes: AuthRoutes
  readonly cookie: SessionCookieOptions
  private readonly clientSecret?: string
  private readonly secret: string
  private readonly store: SessionStore
  private readonly jwks: JWKS
  private readonly fetchImpl: typeof fetch
  private readonly authorizationParams: Record<string, string | undefined>
  private readonly onLogin: FaableAuthNextConfig['onLogin']
  private keyPromise?: Promise<Uint8Array>

  constructor(
    config: FaableAuthNextConfig & {
      /** Test seam: a local JWKS instead of the tenant's remote one. */
      jwks?: JWKS
      /** Test seam: the `fetch` used for the token endpoint. */
      fetch?: typeof fetch
    } = {}
  ) {
    this.issuer = issuerFromDomain(
      required(config.domain ?? env('FAABLE_AUTH_DOMAIN'), 'domain')
    )
    this.clientId = required(
      config.clientId ?? env('FAABLE_AUTH_CLIENT_ID'),
      'clientId'
    )
    this.clientSecret = config.clientSecret ?? env('FAABLE_AUTH_CLIENT_SECRET')
    this.secret = required(config.secret ?? env('FAABLE_AUTH_SECRET'), 'secret')
    if (this.secret.length < 32) {
      throw new Error(
        '@faable/auth-js/nextjs: secret must be at least 32 characters'
      )
    }
    this.baseUrl = required(
      config.baseUrl ?? env('FAABLE_AUTH_BASE_URL') ?? env('APP_BASE_URL'),
      'baseUrl'
    ).replace(/\/+$/, '')
    this.routes = { ...DEFAULT_ROUTES, ...(config.routes ?? {}) }
    this.cookie = {
      name: 'faable_session',
      path: '/',
      sameSite: 'lax',
      secure: !this.baseUrl.startsWith('http://'),
      maxAge: 7 * 24 * 60 * 60,
      ...(config.cookie ?? {})
    }
    this.store = config.sessionStore ?? memorySessionStore()
    this.jwks = config.jwks ?? remoteJwks(this.issuer)
    this.fetchImpl = config.fetch ?? fetch
    this.authorizationParams = config.authorizationParams ?? {}
    this.onLogin = config.onLogin
  }

  // ---- Route handlers -------------------------------------------------------

  /**
   * The App Router handlers. Mount them on a catch-all route:
   * ```ts
   * // app/auth/[...faable]/route.ts
   * export const { GET, POST } = faableAuth.handlers
   * ```
   */
  get handlers(): {
    GET: (req: Request) => Promise<Response>
    POST: (req: Request) => Promise<Response>
  } {
    return {
      GET: req => this.handleRequest(req),
      POST: req => this.handleRequest(req)
    }
  }

  async handleRequest(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url)
    const is = (route: string) => pathname === route || pathname.endsWith(route)
    if (req.method === 'GET' && is(this.routes.login))
      return this.handleLogin(req)
    if (req.method === 'GET' && is(this.routes.callback))
      return this.handleCallback(req)
    if (req.method === 'GET' && is(this.routes.logout))
      return this.handleLogout(req)
    if (req.method === 'POST' && is(this.routes.backchannelLogout)) {
      return this.handleBackchannelLogout(req)
    }
    return json(404, { error: 'not_found' })
  }

  /** `GET /auth/login?returnTo=/x` — starts the Authorization Code + PKCE flow. */
  async handleLogin(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const returnTo = this.safeReturnTo(url.searchParams.get('returnTo'))
    const verifier = randomToken(48)
    const tx: Transaction = {
      state: randomToken(),
      nonce: randomToken(),
      verifier,
      returnTo
    }

    const params = new URLSearchParams()
    const authorize: Record<string, string | undefined> = {
      scope: DEFAULT_SCOPE,
      ...this.authorizationParams
    }
    for (const name of FORWARDED_AUTHORIZE_PARAMS) {
      const v = url.searchParams.get(name)
      if (v) authorize[name] = v
    }
    for (const [k, v] of Object.entries(authorize)) if (v) params.set(k, v)
    params.set('client_id', this.clientId)
    params.set('response_type', 'code')
    params.set('redirect_uri', this.absolute(this.routes.callback))
    params.set('state', tx.state)
    params.set('nonce', tx.nonce)
    params.set('code_challenge', await pkceChallenge(verifier))
    params.set('code_challenge_method', 'S256')

    const sealed = await seal(await this.key(), tx, TX_TTL_SECONDS)
    return redirect(`${this.issuer}/authorize?${params}`, [
      ...writeChunked(this.txCookieName, sealed, {
        ...this.cookieAttributes(),
        maxAge: TX_TTL_SECONDS
      })
    ])
  }

  /** `GET /auth/callback?code&state` — finishes the login and sets the session cookie. */
  async handleCallback(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const jar = jarFromMap(parseCookieHeader(req.headers.get('cookie')))
    const clearTx = deleteChunked(
      jar,
      this.txCookieName,
      this.cookieAttributes()
    )

    const error = url.searchParams.get('error')
    if (error) {
      return json(
        400,
        {
          error,
          error_description:
            url.searchParams.get('error_description') ?? undefined
        },
        { 'set-cookie': clearTx.join(', ') }
      )
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const rawTx = readChunked(jar, this.txCookieName)
    const tx = rawTx ? await unseal<Transaction>(await this.key(), rawTx) : null
    if (!code || !state || !tx || tx.state !== state) {
      return this.callbackError(
        400,
        'invalid_state',
        'the login did not start here, or it took longer than 10 minutes',
        clearTx
      )
    }

    let tokens: TokenResponse
    try {
      tokens = await exchangeCode(
        {
          issuer: this.issuer,
          clientId: this.clientId,
          clientSecret: this.clientSecret,
          code,
          codeVerifier: tx.verifier,
          redirectUri: this.absolute(this.routes.callback)
        },
        this.fetchImpl
      )
    } catch (e) {
      const err = e as OAuthError
      return this.callbackError(
        err.status && err.status < 500 ? 400 : 502,
        err.error ?? 'token_exchange_failed',
        err.error_description ?? err.message,
        clearTx
      )
    }

    let session: ServerSession
    try {
      session = await this.sessionFromTokens(tokens, tx.nonce)
    } catch (e) {
      return this.callbackError(
        400,
        'invalid_id_token',
        (e as Error).message,
        clearTx
      )
    }

    const setCookies = [
      ...(await this.sessionCookies(jar, session)),
      ...clearTx
    ]
    if (this.onLogin) {
      const custom = await this.onLogin({
        session,
        returnTo: tx.returnTo,
        request: req
      })
      if (custom) {
        const res = new Response(custom.body, custom)
        for (const c of setCookies) res.headers.append('set-cookie', c)
        return res
      }
    }
    return redirect(this.absolute(tx.returnTo), setCookies)
  }

  /**
   * `GET /auth/logout?returnTo=/bye` — clears the session cookie and sends the
   * browser through the tenant's `/logout` (RP-initiated logout), so the SSO
   * session ends too and every other app in it is told.
   */
  async handleLogout(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const jar = jarFromMap(parseCookieHeader(req.headers.get('cookie')))
    const session = await this.readSession(jar)
    const returnTo = this.safeReturnTo(url.searchParams.get('returnTo'))

    if (session?.sid) {
      await this.store.revoke({
        sid: session.sid,
        sub: session.user.sub,
        iat: Math.floor(Date.now() / 1000),
        exp: session.iat + this.cookie.maxAge
      })
    }

    const params = new URLSearchParams({ client_id: this.clientId })
    params.set('post_logout_redirect_uri', this.absolute(returnTo))
    if (session?.idToken) params.set('id_token_hint', session.idToken)
    return redirect(
      `${this.issuer}/logout?${params}`,
      deleteChunked(jar, this.cookie.name, this.cookieAttributes())
    )
  }

  /**
   * `POST /auth/backchannel-logout` — OIDC Back-Channel Logout 1.0 receiver.
   * Verifies the `logout_token` against the tenant JWKS and records the
   * ended session in the {@link SessionStore}; from then on
   * {@link getSession} refuses that cookie. Register this URL as the client's
   * `backchannel_logout_uri`.
   */
  async handleBackchannelLogout(req: Request): Promise<Response> {
    let logoutToken: string | null = null
    const type = req.headers.get('content-type') ?? ''
    try {
      if (type.includes('application/x-www-form-urlencoded')) {
        logoutToken = new URLSearchParams(await req.text()).get('logout_token')
      } else if (type.includes('application/json')) {
        logoutToken = ((await req.json()) as any)?.logout_token ?? null
      }
    } catch {
      logoutToken = null
    }
    if (!logoutToken) {
      return json(400, {
        error: 'invalid_request',
        error_description: 'logout_token missing'
      })
    }
    try {
      const claims = await verifyLogoutToken(logoutToken, {
        issuer: this.issuer,
        clientId: this.clientId,
        jwks: this.jwks
      })
      await this.store.revoke({
        sid: claims.sid,
        sub: claims.sub,
        iat: claims.iat,
        exp: claims.iat + this.cookie.maxAge
      })
    } catch (e) {
      return json(400, {
        error: 'invalid_request',
        error_description: (e as Error).message
      })
    }
    return new Response(null, {
      status: 200,
      headers: { 'cache-control': 'no-store' }
    })
  }

  // ---- Reading the session --------------------------------------------------

  /**
   * The current session, or `null`. Reads the cookie from `input` — a
   * `Request` (middleware, Route Handler), a cookie jar (`cookies()` from
   * `next/headers`, `req.cookies`) — or, with no argument, from
   * `next/headers` itself (Server Components, Server Actions).
   *
   * A cookie the back-channel ended is `null` here even though the browser
   * still sends it. Does not refresh: see {@link getAccessToken}.
   */
  async getSession(input?: Request | CookieJar): Promise<ServerSession | null> {
    const jar = await this.resolveJar(input)
    return this.readSession(jar)
  }

  /**
   * A live access token for a server-side call on the user's behalf. Refreshes
   * with the stored refresh token when the current one is about to expire, and
   * writes the new session back to the cookie jar when it can (Route
   * Handlers, Server Actions, or a jar with `set`). From middleware or a Route
   * Handler working on a raw `Request`, append `setCookie` to your response
   * so the browser keeps the refreshed session.
   */
  async getAccessToken(input?: Request | CookieJar): Promise<{
    accessToken: string
    session: ServerSession
    /** `Set-Cookie` values to put on the response when a refresh happened. */
    setCookie: string[]
  } | null> {
    const jar = await this.resolveJar(input)
    const session = await this.readSession(jar)
    if (!session) return null
    const now = Math.floor(Date.now() / 1000)
    if (session.expiresAt - EXPIRY_SKEW_SECONDS > now) {
      return { accessToken: session.accessToken, session, setCookie: [] }
    }
    if (!session.refreshToken) return null
    let tokens: TokenResponse
    try {
      tokens = await refreshTokens(
        {
          issuer: this.issuer,
          clientId: this.clientId,
          clientSecret: this.clientSecret,
          refreshToken: session.refreshToken,
          audience: this.authorizationParams.audience
        },
        this.fetchImpl
      )
    } catch (e) {
      // `invalid_grant`: the session was ended at the server (a logout
      // elsewhere, a revoke) — the cookie is worthless now.
      const err = e as OAuthError
      if (err.status !== undefined && err.status < 500) return null
      throw e
    }
    const refreshed: ServerSession = {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      idToken: tokens.id_token ?? session.idToken,
      expiresAt: this.expiresAt(tokens)
    }
    const setCookie = await this.sessionCookies(jar, refreshed)
    return { accessToken: refreshed.accessToken, session: refreshed, setCookie }
  }

  /**
   * A `middleware.ts` helper: keeps the session fresh on every request and,
   * for the requests `protect` selects, sends anonymous visitors to the login
   * route with `returnTo` set. Returns the `NextResponse` to return.
   * ```ts
   * export const middleware = (req: NextRequest) =>
   *   faableAuth.middleware(req, { protect: req => req.nextUrl.pathname.startsWith('/app') })
   * ```
   */
  async middleware(
    req: Request,
    options: { protect?: (req: Request) => boolean } = {}
  ): Promise<Response> {
    const mod: any = await import('next/server')
    const NextResponse = mod.NextResponse
    const result = await this.getAccessToken(req)
    if (!result && options.protect?.(req)) {
      const { pathname, search } = new URL(req.url)
      const login = new URL(this.absolute(this.routes.login))
      login.searchParams.set('returnTo', `${pathname}${search}`)
      return NextResponse.redirect(login)
    }
    const res: Response = NextResponse.next()
    for (const c of result?.setCookie ?? []) res.headers.append('set-cookie', c)
    return res
  }

  // ---- Internals ------------------------------------------------------------

  private get txCookieName() {
    return `${this.cookie.name}_tx`
  }

  private key(): Promise<Uint8Array> {
    if (!this.keyPromise) this.keyPromise = deriveKey(this.secret)
    return this.keyPromise
  }

  private cookieAttributes(): CookieAttributes {
    return {
      path: this.cookie.path,
      domain: this.cookie.domain,
      sameSite: this.cookie.sameSite,
      secure: this.cookie.secure,
      httpOnly: true,
      maxAge: this.cookie.maxAge
    }
  }

  private absolute(pathOrUrl: string): string {
    return /^https?:\/\//i.test(pathOrUrl)
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl}`
  }

  /**
   * Only paths of this app, or URLs on its own origin, may be a `returnTo`:
   * anything else is an open redirect and falls back to `/`.
   */
  safeReturnTo(value: string | null | undefined): string {
    if (!value) return '/'
    if (
      value.startsWith('/') &&
      !value.startsWith('//') &&
      !value.startsWith('/\\')
    ) {
      return value
    }
    try {
      const u = new URL(value)
      if (u.origin === new URL(this.baseUrl).origin) {
        return `${u.pathname}${u.search}${u.hash}`
      }
    } catch {
      /* not a URL */
    }
    return '/'
  }

  private callbackError(
    status: number,
    error: string,
    description: string,
    setCookies: string[]
  ): Response {
    const res = json(status, { error, error_description: description })
    for (const c of setCookies) res.headers.append('set-cookie', c)
    return res
  }

  private expiresAt(tokens: TokenResponse): number {
    if (typeof tokens.expires_at === 'number') return tokens.expires_at
    return Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600)
  }

  private async sessionFromTokens(
    tokens: TokenResponse,
    nonce: string
  ): Promise<ServerSession> {
    if (!tokens.id_token) {
      throw new Error(
        'no id_token in the token response — is `openid` in scope?'
      )
    }
    const claims = await verifyIdToken(tokens.id_token, {
      issuer: this.issuer,
      clientId: this.clientId,
      nonce,
      jwks: this.jwks
    })
    return {
      user: userFromClaims(claims) as ServerUser,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresAt: this.expiresAt(tokens),
      sid: typeof claims.sid === 'string' ? claims.sid : undefined,
      iat: Math.floor(Date.now() / 1000)
    }
  }

  private async resolveJar(input?: Request | CookieJar): Promise<CookieJar> {
    if (
      input &&
      typeof (input as Request).headers?.get === 'function' &&
      'url' in input
    ) {
      return jarFromMap(
        parseCookieHeader((input as Request).headers.get('cookie'))
      )
    }
    if (input) return input as CookieJar
    const mod: any = await import('next/headers')
    return (await mod.cookies()) as CookieJar
  }

  private async readSession(jar: CookieJar): Promise<ServerSession | null> {
    const raw = readChunked(jar, this.cookie.name)
    if (!raw) return null
    const session = await unseal<ServerSession>(await this.key(), raw)
    if (!session || !session.user?.sub || !session.accessToken) return null
    const revoked = await this.store.isRevoked({
      sid: session.sid,
      sub: session.user.sub,
      iat: session.iat
    })
    return revoked ? null : session
  }

  /**
   * Seals `session` and returns the `Set-Cookie` values that store it. When
   * the jar can write (`cookies()` in a Route Handler or Server Action) the
   * cookies are also set there; a jar that cannot (a Server Component) is
   * left alone, and the caller uses the returned values or nothing.
   */
  private async sessionCookies(
    jar: CookieJar,
    session: ServerSession
  ): Promise<string[]> {
    const { user, accessToken, refreshToken, idToken, expiresAt, sid, iat } =
      session
    const sealed = await seal(
      await this.key(),
      { user, accessToken, refreshToken, idToken, expiresAt, sid, iat },
      this.cookie.maxAge
    )
    const attrs = this.cookieAttributes()
    const stale = existingNames(jar, this.cookie.name)
    const headers = writeChunked(this.cookie.name, sealed, attrs, stale)
    if (typeof jar.set === 'function') {
      try {
        for (const h of headers) {
          const [pair] = h.split(';')
          const eq = pair.indexOf('=')
          const name = pair.slice(0, eq)
          const value = decodeURIComponent(pair.slice(eq + 1))
          if (value === '')
            jar.set(name, '', { ...attrs, maxAge: 0, expires: new Date(0) })
          else jar.set(name, value, attrs)
        }
      } catch {
        // Server Components cannot set cookies; the session still works for
        // this request and is written the next time a handler runs.
      }
    }
    return headers
  }
}

/**
 * Create the server-side Faable Auth instance for a Next.js app — one per
 * app, in a module both the route file and your pages import.
 * @example
 * ```ts
 * // lib/faable-auth.ts
 * import { createFaableAuth } from '@faable/auth-js/nextjs'
 * export const faableAuth = createFaableAuth() // reads FAABLE_AUTH_* from the environment
 * ```
 */
export const createFaableAuth = (config: FaableAuthNextConfig = {}) =>
  new FaableAuthNext(config)

export { expireCookie }
