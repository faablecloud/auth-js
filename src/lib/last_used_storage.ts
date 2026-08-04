import { document } from './globals'
import { isBrowser } from './helpers'
import { CookieJar } from './storage/cookie-storage'
import { parseCookies, serializeCookie } from './storage/cookie_helpers'
import { getItemAsync, setItemAsync } from './storage_helpers'
import type { LastUsedCookieOptions, SupportedStorage } from './types'

/**
 * How long a login attempt stays promotable. Mirrors the PKCE verifier TTL:
 * both describe the same round-trip through the auth server, so an attempt
 * older than this belongs to an abandoned flow and must not be promoted.
 */
export const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000

/** Default lifetime of the last-used cookie: 180 days. */
const DEFAULT_LAST_USED_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

/**
 * Login method families the SDK can initiate. OAuth carries the connection
 * identifiers so UIs with several social buttons can tell them apart.
 */
export type LastUsedLoginMethodKind = 'oauth' | 'password' | 'otp'

const LOGIN_METHOD_KINDS: LastUsedLoginMethodKind[] = [
  'oauth',
  'password',
  'otp'
]

/**
 * A confirmed login, as recorded after the session was actually established —
 * clicking a sign-in button that ends in an error never produces one.
 *
 * @see {@link FaableAuthClient.getLastUsedLoginMethod}
 */
export type LastUsedLoginMethod = {
  method: LastUsedLoginMethodKind
  /** Connection name passed to the sign-in call, when there was one. */
  connection?: string
  /** Connection id passed to the sign-in call, when there was one. */
  connection_id?: string
  /** Epoch milliseconds of the confirmed login. */
  at: number
}

type StoredLoginAttempt = {
  method: LastUsedLoginMethodKind
  connection?: string
  connection_id?: string
  createdAt: number
}

const isLoginMethodKind = (value: unknown): value is LastUsedLoginMethodKind =>
  LOGIN_METHOD_KINDS.includes(value as LastUsedLoginMethodKind)

const isStoredLoginAttempt = (value: unknown): value is StoredLoginAttempt =>
  typeof value === 'object' &&
  value !== null &&
  isLoginMethodKind((value as StoredLoginAttempt).method) &&
  typeof (value as StoredLoginAttempt).createdAt === 'number'

const isLastUsedLoginMethod = (value: unknown): value is LastUsedLoginMethod =>
  typeof value === 'object' &&
  value !== null &&
  isLoginMethodKind((value as LastUsedLoginMethod).method) &&
  typeof (value as LastUsedLoginMethod).at === 'number'

const attemptKey = (storageKey: string) => `${storageKey}-login-attempt`
const lastUsedKey = (storageKey: string) => `${storageKey}-last-used`

/**
 * Records that a login was *started*. Written just before the browser
 * navigates away (OAuth redirect / username-password form submit), on the
 * client's regular storage — the callback lands on the same origin, so
 * cross-subdomain reach is not needed here.
 */
export const saveLoginAttempt = async (
  storage: SupportedStorage,
  storageKey: string,
  {
    method,
    connection,
    connection_id,
    now = Date.now()
  }: {
    method: LastUsedLoginMethodKind
    connection?: string
    connection_id?: string
    now?: number
  }
): Promise<void> => {
  const payload: StoredLoginAttempt = { method, createdAt: now }
  if (connection) {
    payload.connection = connection
  }
  if (connection_id) {
    payload.connection_id = connection_id
  }
  await setItemAsync(storage, attemptKey(storageKey), payload)
}

/**
 * Reads-and-deletes the pending login attempt. Returns `null` when there is
 * none, the record is malformed, or it outlived {@link LOGIN_ATTEMPT_TTL_MS};
 * in every case the record is gone afterwards, so an attempt can only ever be
 * promoted once.
 */
export const consumeLoginAttempt = async (
  storage: SupportedStorage,
  storageKey: string,
  { now = Date.now() }: { now?: number } = {}
): Promise<Omit<StoredLoginAttempt, 'createdAt'> | null> => {
  const key = attemptKey(storageKey)
  const raw = await getItemAsync(storage, key)
  if (raw === null) {
    return null
  }
  await storage.removeItem(key)

  if (
    !isStoredLoginAttempt(raw) ||
    now - raw.createdAt > LOGIN_ATTEMPT_TTL_MS
  ) {
    return null
  }

  const attempt: Omit<StoredLoginAttempt, 'createdAt'> = { method: raw.method }
  if (raw.connection) {
    attempt.connection = raw.connection
  }
  if (raw.connection_id) {
    attempt.connection_id = raw.connection_id
  }
  return attempt
}

const lastUsedCookieAttrs = (options: LastUsedCookieOptions = {}) => ({
  path: '/',
  sameSite: 'Lax' as const,
  secure: isBrowser() && window.location.protocol === 'https:',
  maxAge: options.maxAge ?? DEFAULT_LAST_USED_MAX_AGE_SECONDS,
  ...(options.domain ? { domain: options.domain } : {})
})

/**
 * Persists the confirmed login method. Deliberately a dedicated cookie rather
 * than the client's storage adapter: a `Domain=.example.com` cookie lets a
 * login page on one subdomain show the hint for a login performed on another,
 * which localStorage (per-origin) cannot do. No-op outside the browser.
 */
export const saveLastUsedMethod = (
  storageKey: string,
  record: LastUsedLoginMethod,
  options: LastUsedCookieOptions = {},
  jar: CookieJar | null = isBrowser() ? document : null
): void => {
  if (!jar) return
  jar.cookie = serializeCookie(
    lastUsedKey(storageKey),
    JSON.stringify(record),
    lastUsedCookieAttrs(options)
  )
}

/**
 * Reads the confirmed last-used login method back. Returns `null` outside the
 * browser or when the cookie is absent or malformed.
 */
export const loadLastUsedMethod = (
  storageKey: string,
  jar: CookieJar | null = isBrowser() ? document : null
): LastUsedLoginMethod | null => {
  if (!jar) return null
  const raw = parseCookies(jar.cookie).get(lastUsedKey(storageKey))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return isLastUsedLoginMethod(parsed) ? parsed : null
  } catch {
    return null
  }
}
