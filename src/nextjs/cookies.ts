// Cookie plumbing for the Next.js helper: parsing, serialising, chunking and
// the encryption that makes the session cookie opaque to the browser.
//
// Everything here works on the standard `Request`/`Response` headers plus the
// structural `CookieJar` interface, so the same code serves Route Handlers,
// middleware and Server Components without importing `next/*`.
import { EncryptJWT, jwtDecrypt } from 'jose'
import type { CookieAttributes, CookieJar } from './types'

// Browsers cap a cookie at ~4096 bytes including name and attributes. The
// encrypted session is base64url (no further encoding on write), so this
// leaves room for the longest realistic name + attribute tail.
export const MAX_CHUNK_SIZE = 3500

/** `Cookie:` header → name/value map. Later duplicates win, like browsers. */
export const parseCookieHeader = (
  header: string | null
): Map<string, string> => {
  const out = new Map<string, string>()
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    let value = part.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    try {
      out.set(name, decodeURIComponent(value))
    } catch {
      out.set(name, value)
    }
  }
  return out
}

/** A `CookieJar` over an immutable map (a parsed `Cookie:` header). */
export const jarFromMap = (map: Map<string, string>): CookieJar => ({
  get: name => {
    const value = map.get(name)
    return value === undefined ? undefined : { value }
  },
  getAll: () => Array.from(map, ([name, value]) => ({ name, value }))
})

export const serializeCookie = (
  name: string,
  value: string,
  attrs: CookieAttributes = {}
): string => {
  let out = `${name}=${encodeURIComponent(value)}`
  if (attrs.maxAge !== undefined) out += `; Max-Age=${Math.floor(attrs.maxAge)}`
  if (attrs.expires) out += `; Expires=${attrs.expires.toUTCString()}`
  if (attrs.domain) out += `; Domain=${attrs.domain}`
  out += `; Path=${attrs.path ?? '/'}`
  if (attrs.secure) out += '; Secure'
  if (attrs.httpOnly) out += '; HttpOnly'
  if (attrs.sameSite) {
    const v = attrs.sameSite
    out += `; SameSite=${v.charAt(0).toUpperCase()}${v.slice(1)}`
  }
  return out
}

const chunkName = (name: string, idx: number) => `${name}.${idx}`

/**
 * Names under which `name` may currently live in the jar: the plain cookie
 * and every numbered chunk. Used to clear all of them on write and delete.
 */
const existingNames = (jar: CookieJar, name: string): string[] => {
  const names = new Set<string>()
  if (jar.get(name)) names.add(name)
  const all = jar.getAll?.()
  if (all) {
    const prefix = `${name}.`
    for (const c of all) {
      if (
        c.name.startsWith(prefix) &&
        /^\d+$/.test(c.name.slice(prefix.length))
      ) {
        names.add(c.name)
      }
    }
  } else {
    for (let i = 0; ; i++) {
      if (!jar.get(chunkName(name, i))) break
      names.add(chunkName(name, i))
    }
  }
  return Array.from(names)
}

/** Reads `name`, reassembling `name.0`, `name.1`, … when it was chunked. */
export const readChunked = (jar: CookieJar, name: string): string | null => {
  const single = jar.get(name)?.value
  if (single) return single
  const chunks: string[] = []
  for (let i = 0; ; i++) {
    const value = jar.get(chunkName(name, i))?.value
    if (!value) break
    chunks.push(value)
  }
  return chunks.length ? chunks.join('') : null
}

/**
 * The `Set-Cookie` headers that store `value` under `name`, split into
 * numbered chunks when it does not fit one cookie, plus the deletions of
 * whatever shape it had before (`existing`) that the new write does not
 * cover — so a session that shrank back to one cookie leaves no stale
 * `.1` behind.
 */
export const writeChunked = (
  name: string,
  value: string,
  attrs: CookieAttributes,
  existing: string[] = []
): string[] => {
  const out: string[] = []
  const written = new Set<string>()
  if (value.length <= MAX_CHUNK_SIZE) {
    out.push(serializeCookie(name, value, attrs))
    written.add(name)
  } else {
    for (let i = 0, idx = 0; i < value.length; i += MAX_CHUNK_SIZE, idx++) {
      const n = chunkName(name, idx)
      out.push(serializeCookie(n, value.slice(i, i + MAX_CHUNK_SIZE), attrs))
      written.add(n)
    }
  }
  for (const stale of existing) {
    if (!written.has(stale)) out.push(expireCookie(stale, attrs))
  }
  return out
}

export const expireCookie = (name: string, attrs: CookieAttributes): string =>
  serializeCookie(name, '', {
    path: attrs.path,
    domain: attrs.domain,
    secure: attrs.secure,
    httpOnly: attrs.httpOnly,
    sameSite: attrs.sameSite,
    maxAge: 0,
    expires: new Date(0)
  })

/** Every `Set-Cookie` that removes `name` in whatever shape the jar holds it. */
export const deleteChunked = (
  jar: CookieJar,
  name: string,
  attrs: CookieAttributes
): string[] => existingNames(jar, name).map(n => expireCookie(n, attrs))

export { existingNames }

// ---- Sealing --------------------------------------------------------------

const encoder = new TextEncoder()

/**
 * The 256-bit key for `dir`/`A256GCM`, derived from the configured secret
 * with SHA-256 so any string of sufficient entropy works as a secret.
 */
export const deriveKey = async (secret: string): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return new Uint8Array(digest)
}

/**
 * Encrypts `payload` into a compact JWE (`dir` + `A256GCM`): confidential,
 * integrity-protected and bound to `ttl` seconds. What the browser stores is
 * this string; only a server holding the secret can read or forge it.
 */
export const seal = async (
  key: Uint8Array,
  payload: Record<string, unknown>,
  ttlSeconds: number,
  now: number = Math.floor(Date.now() / 1000)
): Promise<string> =>
  new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .encrypt(key)

/** Inverse of {@link seal}. `null` for anything not sealed with `key`, or expired. */
export const unseal = async <T = Record<string, unknown>>(
  key: Uint8Array,
  token: string
): Promise<T | null> => {
  try {
    const { payload } = await jwtDecrypt(token, key, { clockTolerance: 60 })
    return payload as unknown as T
  } catch {
    return null
  }
}
