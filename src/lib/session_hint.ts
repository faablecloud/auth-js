import { STORAGE_KEY } from './constants'
import { document, window } from './globals'
import type { CookieJar } from './storage/cookie-storage'
import {
  type CookieAttributes,
  parseCookies,
  serializeCookie,
  serializeCookieRemoval
} from './storage/cookie_helpers'
import type { SessionHintCookieOptions } from './types'

/** Default lifetime of the session hint cookie: 30 days, renewed on every save. */
const DEFAULT_SESSION_HINT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const SUFFIX = '-session-hint'

const hasBrowserJar = () => !!window && !!document

const defaultJar = (): CookieJar | null =>
  hasBrowserJar() ? (document as CookieJar) : null

const hintKey = (storageKey: string) => `${storageKey}${SUFFIX}`

const attrs = (options: SessionHintCookieOptions): CookieAttributes => ({
  path: '/',
  sameSite: 'Lax',
  secure: !!window && !!document && window.location.protocol === 'https:',
  maxAge: options.maxAge ?? DEFAULT_SESSION_HINT_MAX_AGE_SECONDS,
  ...(options.domain ? { domain: options.domain } : {})
})

/**
 * Marks the browser as signed in. Called by the client each time it persists
 * a session (sign-in, token refresh, user update), so the cookie lives as long
 * as the session keeps being used plus its max-age. Carries no token and no
 * personal data — only `1` — because with a parent `domain` every subdomain,
 * including ones running third-party code, can read it. No-op outside the
 * browser.
 */
export const saveSessionHint = (
  storageKey: string,
  options: SessionHintCookieOptions,
  jar: CookieJar | null = defaultJar()
): void => {
  if (!jar) return
  jar.cookie = serializeCookie(hintKey(storageKey), '1', attrs(options))
}

/**
 * Removes the hint. Called whenever the client drops its session — sign-out,
 * a refresh token the server rejects, a session that cannot be recovered.
 * Mirrors the write attributes: a browser only deletes a cookie whose Domain
 * and Path match the ones it was set with.
 */
export const clearSessionHint = (
  storageKey: string,
  options: SessionHintCookieOptions,
  jar: CookieJar | null = defaultJar()
): void => {
  if (!jar) return
  jar.cookie = serializeCookieRemoval(hintKey(storageKey), attrs(options))
}

/**
 * Whether this browser holds a Faable Auth session for an app that enabled
 * `sessionHintCookie` — readable from any page the cookie's domain covers, so
 * a marketing site on `example.com` can offer "Go to app" instead of "Sign up"
 * to someone signed in to `app.example.com`.
 *
 * A hint, not proof: it says the app had a session the last time it ran in
 * this browser, and is cleared when the app signs out or loses the session.
 * Never use it to authorize anything.
 *
 * Without arguments it answers for any client; pass `clientId` (and
 * `storageKey` if you changed the prefix) to ask about one app.
 *
 * Also exported from `@faable/auth-js/session-hint`, a few hundred bytes with
 * no client attached, for pages that do not sign anyone in.
 *
 * @example
 * ```ts
 * import { hasSessionHint } from '@faable/auth-js/session-hint'
 *
 * const cta = hasSessionHint() ? 'Go to dashboard' : 'Start free'
 * ```
 */
export const hasSessionHint = (
  {
    clientId,
    storageKey = STORAGE_KEY
  }: { clientId?: string; storageKey?: string } = {},
  jar: CookieJar | null = defaultJar()
): boolean => {
  if (!jar) return false
  const cookies = parseCookies(jar.cookie)
  if (clientId) return cookies.get(hintKey(`${storageKey}-${clientId}`)) === '1'
  const prefix = `${storageKey}-`
  let found = false
  cookies.forEach((value, name) => {
    if (name.startsWith(prefix) && name.endsWith(SUFFIX) && value === '1')
      found = true
  })
  return found
}
