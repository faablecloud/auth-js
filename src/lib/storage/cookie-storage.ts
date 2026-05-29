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

/** Default cookie lifetime when the caller doesn't override `maxAge`. */
const DEFAULT_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/**
 * Maximum raw bytes we put in a single cookie value before splitting. Browsers
 * cap individual cookies at ~4096 bytes including name + attributes; after
 * URL-encoding (typical ratio ~1.1x for JSON sessions) and the attribute tail
 * (`Max-Age=…; Path=/; SameSite=Lax; …`) this leaves enough headroom even for
 * the longest realistic cookie names.
 */
const MAX_CHUNK_SIZE = 3200

const chunkKey = (key: string, idx: number): string => `${key}.${idx}`

/**
 * Returns the chunk keys for `key` in numeric order. A "chunk key" is one
 * shaped like `<key>.<integer>`; foreign cookies that happen to share the
 * prefix (e.g. `key-suffix`) are ignored thanks to the dot + digits check.
 */
const collectChunkKeys = (
  parsed: Map<string, string>,
  key: string
): string[] => {
  const prefix = `${key}.`
  const found: { name: string; idx: number }[] = []
  parsed.forEach((_value, name) => {
    if (!name.startsWith(prefix)) return
    const tail = name.slice(prefix.length)
    if (!/^\d+$/.test(tail)) return
    found.push({ name, idx: Number(tail) })
  })
  found.sort((a, b) => a.idx - b.idx)
  return found.map(c => c.name)
}

/**
 * Reads `key` from the parsed cookie map. Prefers a single un-chunked cookie
 * (back-compat with sessions written by earlier SDK versions); falls back to
 * concatenating numbered chunks. Returns null when nothing is found.
 */
export const readChunkedCookieValue = (
  parsed: Map<string, string>,
  key: string
): string | null => {
  const single = parsed.get(key)
  if (single !== undefined) return single
  const chunkNames = collectChunkKeys(parsed, key)
  if (chunkNames.length === 0) return null
  return chunkNames.map(name => parsed.get(name) as string).join('')
}

/**
 * Storage adapter that persists the session in `document.cookie`.
 *
 * Pick this adapter when you need SSR (server reads the cookie on every
 * request) or want to scope storage with `Secure`, `SameSite`, or `Domain`.
 * The simplest way to enable it is `createClient({ storage: 'cookie' })` or
 * by passing `cookieOptions` — the SDK calls this factory internally.
 *
 * Defaults applied to every cookie: `Path=/`, `SameSite=Lax`, `Secure` on
 * HTTPS, 30-day `Max-Age`. Override any of them through `options`. Values
 * larger than the per-cookie browser limit (~4 KB) are transparently split
 * across numbered chunks (`<key>.0`, `<key>.1`, …) and re-assembled on read.
 *
 * @param options Attribute overrides for every written cookie.
 * @param jar Document-like object whose `cookie` property is read/written.
 *   Defaults to `document` in browsers and `null` (no-op) on the server —
 *   only override for tests.
 * @returns A {@link SupportedStorage} ready to pass to {@link createClient}.
 * @example
 * ```ts
 * import { createClient } from '@faable/auth-js'
 *
 * export const auth = createClient({
 *   domain: '<faableauth_domain>',
 *   clientId: '<client_id>',
 *   storage: 'cookie',
 *   cookieOptions: { domain: '.example.com' }
 * })
 * ```
 * @see {@link https://faable.com/docs/auth/quickstart/nextjs | Next.js Quickstart}
 */
export const cookieStorageAdapter = (
  options: CookieOptions = {},
  jar: CookieJar | null = isBrowser() ? document : null
): SupportedStorage => {
  const attrs: CookieAttributes = {
    path: '/',
    sameSite: 'Lax',
    secure: isBrowser() && window.location.protocol === 'https:',
    maxAge: DEFAULT_COOKIE_MAX_AGE_SECONDS,
    ...options
  }

  return {
    getItem: (key: string) => {
      if (!jar) return null
      const parsed = parseCookies(jar.cookie)
      return readChunkedCookieValue(parsed, key)
    },

    setItem: (key: string, value: string) => {
      if (!jar) return
      const parsed = parseCookies(jar.cookie)

      if (value.length <= MAX_CHUNK_SIZE) {
        // Single cookie path. Wipe any stale chunks left from a prior large
        // value so a subsequent `getItem` doesn't reassemble garbage.
        for (const name of collectChunkKeys(parsed, key)) {
          jar.cookie = serializeCookieRemoval(name, attrs)
        }
        jar.cookie = serializeCookie(key, value, attrs)
        return
      }

      // Chunked path. Drop a stale single (if any) and any chunks that fall
      // beyond the new count; the surviving chunk indices get overwritten by
      // the loop below.
      if (parsed.has(key)) {
        jar.cookie = serializeCookieRemoval(key, attrs)
      }
      const newCount = Math.ceil(value.length / MAX_CHUNK_SIZE)
      for (const name of collectChunkKeys(parsed, key)) {
        const idx = Number(name.slice(key.length + 1))
        if (idx >= newCount) {
          jar.cookie = serializeCookieRemoval(name, attrs)
        }
      }
      for (let pos = 0, i = 0; pos < value.length; pos += MAX_CHUNK_SIZE, i++) {
        const slice = value.slice(pos, pos + MAX_CHUNK_SIZE)
        jar.cookie = serializeCookie(chunkKey(key, i), slice, attrs)
      }
    },

    removeItem: (key: string) => {
      if (!jar) return
      // Always emit the single removal so the call mirrors a `Set-Cookie:
      // key=; Max-Age=0` (browsers no-op on absent cookies) and additionally
      // clear every chunk we can see.
      const parsed = parseCookies(jar.cookie)
      jar.cookie = serializeCookieRemoval(key, attrs)
      for (const name of collectChunkKeys(parsed, key)) {
        jar.cookie = serializeCookieRemoval(name, attrs)
      }
    }
  }
}
