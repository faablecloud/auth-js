import { isBrowser } from '../helpers'
import { SupportedStorage } from '../types'
import {
  CookieAttributes,
  parseCookies,
  serializeCookie,
  serializeCookieRemoval
} from './cookie_helpers'

export type CookieOptions = CookieAttributes

/**
 * Document-like surface the cookie adapter needs. Accepting a minimal shape
 * (instead of the full DOM `Document`) keeps the adapter testable without
 * jsdom and works in any environment that exposes a `cookie` property.
 */
export interface CookieJar {
  cookie: string
}

/**
 * A storage adapter that uses `document.cookie` to persist sessions. Useful
 * in SSR setups where the server reads the cookie on every request.
 *
 * The optional `jar` parameter lets tests inject a fake document; production
 * code passes nothing and the adapter uses the real `document` in browsers
 * (and no-ops on the server).
 */
export const cookieStorageAdapter = (
  options: CookieOptions = {},
  jar: CookieJar | null = isBrowser() ? document : null
): SupportedStorage => {
  const attrs: CookieAttributes = {
    path: '/',
    sameSite: 'Lax',
    secure: isBrowser() && window.location.protocol === 'https:',
    ...options
  }

  return {
    getItem: (key: string) => {
      if (!jar) return null
      const parsed = parseCookies(jar.cookie)
      return parsed.has(key) ? (parsed.get(key) as string) : null
    },

    setItem: (key: string, value: string) => {
      if (!jar) return
      jar.cookie = serializeCookie(key, value, attrs)
    },

    removeItem: (key: string) => {
      if (!jar) return
      jar.cookie = serializeCookieRemoval(key, attrs)
    }
  }
}
