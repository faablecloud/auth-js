// The OIDC side of the Next.js helper: PKCE, the token endpoint and the two
// verifications against the tenant JWKS (id_token at login, logout_token on
// the back-channel). Pure functions over `fetch` and `jose`, so tests can
// hand in a local JWKS and a fake token endpoint.
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose'
import type { TokenResponse } from './types'

export type JWKS = ReturnType<typeof createRemoteJWKSet>

/** `https://tenant.auth.faable.link` from either the bare host or a URL. */
export const issuerFromDomain = (domain: string): string => {
  const withScheme = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
  return withScheme.replace(/\/+$/, '')
}

export const remoteJwks = (issuer: string): JWKS =>
  createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))

// ---- PKCE / random ----------------------------------------------------------

const base64url = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const randomToken = (bytes = 32): string => {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

export const pkceChallenge = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  )
  return base64url(new Uint8Array(digest))
}

// ---- Token endpoint ---------------------------------------------------------

export class OAuthError extends Error {
  constructor(
    public error: string,
    public error_description?: string,
    public status?: number
  ) {
    super(error_description ? `${error}: ${error_description}` : error)
    this.name = 'OAuthError'
  }
}

const tokenRequest = async (
  issuer: string,
  body: Record<string, string | undefined>,
  fetchImpl: typeof fetch
): Promise<TokenResponse> => {
  const defined = Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined)
  )
  const res = await fetchImpl(`${issuer}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(defined)
  })
  let json: any
  try {
    json = await res.json()
  } catch {
    json = null
  }
  if (!res.ok) {
    // RFC 6749 §5.2 — `{ error, error_description? }`.
    throw new OAuthError(
      json?.error ?? `http_${res.status}`,
      json?.error_description ?? json?.message,
      res.status
    )
  }
  if (!json?.access_token) {
    throw new OAuthError(
      'invalid_response',
      'token response has no access_token',
      res.status
    )
  }
  return json as TokenResponse
}

export const exchangeCode = (
  params: {
    issuer: string
    clientId: string
    clientSecret?: string
    code: string
    codeVerifier: string
    redirectUri: string
  },
  fetchImpl: typeof fetch = fetch
): Promise<TokenResponse> =>
  tokenRequest(
    params.issuer,
    {
      grant_type: 'authorization_code',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri
    },
    fetchImpl
  )

export const refreshTokens = (
  params: {
    issuer: string
    clientId: string
    clientSecret?: string
    refreshToken: string
    audience?: string
  },
  fetchImpl: typeof fetch = fetch
): Promise<TokenResponse> =>
  tokenRequest(
    params.issuer,
    {
      grant_type: 'refresh_token',
      client_id: params.clientId,
      client_secret: params.clientSecret,
      refresh_token: params.refreshToken,
      audience: params.audience
    },
    fetchImpl
  )

// ---- Verification -----------------------------------------------------------

/**
 * OIDC Core §3.1.3.7 — the checks an RP owes an id_token it just received:
 * signature against the JWKS, `iss`, `aud` (= our client_id), `exp`, and the
 * `nonce` we put in the request.
 */
export const verifyIdToken = async (
  idToken: string,
  params: { issuer: string; clientId: string; nonce?: string; jwks: JWKS }
): Promise<JWTPayload> => {
  const { payload } = await jwtVerify(idToken, params.jwks, {
    issuer: params.issuer,
    audience: params.clientId,
    algorithms: ['RS256'],
    clockTolerance: 60
  })
  if (params.nonce !== undefined && payload.nonce !== params.nonce) {
    throw new Error('id_token nonce mismatch')
  }
  if (!payload.sub) throw new Error('id_token has no sub')
  return payload
}

export const BACKCHANNEL_LOGOUT_EVENT =
  'http://schemas.openid.net/event/backchannel-logout'

/**
 * OIDC Back-Channel Logout 1.0 §2.6 — what an RP validates on a
 * `logout_token` before acting on it. A token that passes names a session
 * (`sid`) and/or a user (`sub`) to end.
 */
export const verifyLogoutToken = async (
  logoutToken: string,
  params: {
    issuer: string
    clientId: string
    jwks: JWKS
    now?: number
    /** How old (seconds) an `iat` may be. Default 5 minutes. */
    maxAge?: number
  }
): Promise<{ sid?: string; sub?: string; iat: number; jti?: string }> => {
  const { payload, protectedHeader } = await jwtVerify(
    logoutToken,
    params.jwks,
    {
      issuer: params.issuer,
      audience: params.clientId,
      algorithms: ['RS256'],
      clockTolerance: 60,
      // §2.6 (4): `typ`, when present, MUST be `logout+jwt`.
      ...(params.now !== undefined
        ? { currentDate: new Date(params.now * 1000) }
        : {})
    }
  )
  if (protectedHeader.typ && protectedHeader.typ !== 'logout+jwt') {
    throw new Error(
      `logout_token typ must be logout+jwt, got ${protectedHeader.typ}`
    )
  }
  const events = payload.events as Record<string, unknown> | undefined
  if (
    !events ||
    typeof events !== 'object' ||
    !(BACKCHANNEL_LOGOUT_EVENT in events)
  ) {
    throw new Error('logout_token has no backchannel-logout event')
  }
  if (!payload.sid && !payload.sub) {
    throw new Error('logout_token carries neither sid nor sub')
  }
  if ('nonce' in payload) {
    throw new Error('logout_token must not carry a nonce')
  }
  if (typeof payload.iat !== 'number') {
    throw new Error('logout_token has no iat')
  }
  const now = params.now ?? Math.floor(Date.now() / 1000)
  const maxAge = params.maxAge ?? 5 * 60
  if (now - payload.iat > maxAge + 60) {
    throw new Error('logout_token iat is too old')
  }
  return {
    sid: typeof payload.sid === 'string' ? payload.sid : undefined,
    sub: payload.sub,
    iat: payload.iat,
    jti: payload.jti
  }
}

// Claims that describe the token, not the person — kept out of `user`.
const REGISTERED_CLAIMS = new Set([
  'iss',
  'aud',
  'exp',
  'iat',
  'nbf',
  'jti',
  'nonce',
  'at_hash',
  'c_hash',
  'auth_time',
  'sid',
  'amr',
  'acr',
  'azp',
  'scope',
  'client_id',
  'client',
  'account'
])

/** The end user as the id_token describes them: every claim but the token's own. */
export const userFromClaims = (
  claims: JWTPayload
): Record<string, unknown> & { sub: string } => {
  const user: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(claims)) {
    if (!REGISTERED_CLAIMS.has(k)) user[k] = v
  }
  return user as Record<string, unknown> & { sub: string }
}
