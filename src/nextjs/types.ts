/**
 * Configuration for {@link createFaableAuth}.
 *
 * Every field can also come from the environment (`FAABLE_AUTH_DOMAIN`,
 * `FAABLE_AUTH_CLIENT_ID`, `FAABLE_AUTH_CLIENT_SECRET`, `FAABLE_AUTH_SECRET`,
 * `FAABLE_AUTH_BASE_URL`); an explicit value wins.
 */
export interface FaableAuthNextConfig {
  /** Tenant host (`your-tenant.auth.faable.link`) or full URL. */
  domain?: string
  /** OAuth client id of this application. */
  clientId?: string
  /**
   * Client secret, when the client is confidential. Sent as
   * `client_secret_post` at the token endpoint. Public (PKCE-only) clients
   * leave it out.
   */
  clientSecret?: string
  /**
   * Secret that encrypts the session cookie (at least 32 characters). Rotate
   * it and every session is signed out.
   */
  secret?: string
  /** Public origin of this app, e.g. `https://app.example.com`. */
  baseUrl?: string
  /**
   * Paths the handlers answer on, relative to `baseUrl`. Defaults: `/auth/login`,
   * `/auth/callback`, `/auth/logout`, `/auth/backchannel-logout`. The callback
   * must be registered as an allowed callback URL on the client, and
   * `baseUrl` + the post-logout page as a logout URL.
   */
  routes?: Partial<AuthRoutes>
  /** Session cookie attributes. */
  cookie?: Partial<SessionCookieOptions>
  /**
   * Extra `/authorize` parameters sent on every login: `scope` (default
   * `openid profile email`), `audience`, `connection`, `acr_values`, …
   * A query parameter on the login route with the same name wins.
   */
  authorizationParams?: Record<string, string | undefined>
  /**
   * Where back-channel logouts are recorded, and what {@link FaableAuthNext.getSession}
   * asks before trusting a cookie. Defaults to an in-memory store, which is
   * enough for one process; with several instances use a shared one (Redis).
   */
  sessionStore?: SessionStore
  /**
   * Called on a successful login, before the redirect. Return a `Response` to
   * take over (the session cookie is still set on it), or nothing to let the
   * default redirect to `returnTo` happen.
   */
  onLogin?: (ctx: {
    session: ServerSession
    returnTo: string
    request: Request
  }) => Promise<Response | void> | Response | void
}

export interface AuthRoutes {
  login: string
  callback: string
  logout: string
  backchannelLogout: string
}

export interface SessionCookieOptions {
  /** Cookie name. Default `faable_session`. */
  name: string
  /** Default `/`. */
  path: string
  /** Default: host-only (no `Domain` attribute). */
  domain?: string
  /** Default `lax`. */
  sameSite: 'lax' | 'strict' | 'none'
  /** Default: `true` unless `baseUrl` is plain `http://`. */
  secure: boolean
  /** Lifetime in seconds of the session cookie. Default 7 days. */
  maxAge: number
}

/**
 * What a back-channel logout records, and what a cookie is checked against.
 * Implement it over Redis (or any shared store) when the app runs on more
 * than one instance; the in-memory default only knows about its own process.
 */
export interface SessionStore {
  /**
   * A `logout_token` for `sid` (and/or `sub`) was verified: from now on any
   * session carrying that `sid` — or, without one, any session of `sub`
   * issued before `iat` — must be treated as ended. `exp` is a hint of how
   * long the record has to live (the session cookie's lifetime).
   */
  revoke(input: {
    sid?: string
    sub?: string
    iat: number
    exp: number
  }): Promise<void> | void
  /**
   * Whether a session with this `sid` (issued at `iat` for `sub`) was
   * revoked through the back-channel.
   */
  isRevoked(input: {
    sid?: string
    sub: string
    iat: number
  }): Promise<boolean> | boolean
}

/** The user as the verified `id_token` describes them. */
export interface ServerUser {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  given_name?: string
  family_name?: string
  nickname?: string
  preferred_username?: string
  picture?: string
  locale?: string
  phone_number?: string
  phone_number_verified?: boolean
  updated_at?: number | string
  [claim: string]: unknown
}

/**
 * The session as stored in the `HttpOnly` cookie. Tokens are only ever read
 * on the server; the browser sees the cookie as an opaque encrypted blob.
 */
export interface ServerSession {
  user: ServerUser
  accessToken: string
  refreshToken?: string
  idToken: string
  /** Access token expiry, seconds since the epoch. */
  expiresAt: number
  /** OIDC session id (`sid` of the id_token) — what back-channel logout names. */
  sid?: string
  /** When this session was established (seconds since the epoch). */
  iat: number
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  expires_at?: number
  token_type?: string
}

/** Minimal cookie jar: what `cookies()` from `next/headers` and `NextRequest.cookies` both satisfy. */
export interface CookieJar {
  get(name: string): { value: string } | undefined
  getAll?(): { name: string; value: string }[]
  set?(name: string, value: string, attributes?: CookieAttributes): unknown
  delete?(
    name: string | { name: string; path?: string; domain?: string }
  ): unknown
}

export interface CookieAttributes {
  path?: string
  domain?: string
  sameSite?: 'lax' | 'strict' | 'none'
  secure?: boolean
  httpOnly?: boolean
  maxAge?: number
  expires?: Date
}
