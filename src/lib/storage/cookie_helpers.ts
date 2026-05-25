export interface CookieAttributes {
  domain?: string
  path?: string
  sameSite?: 'Lax' | 'Strict' | 'None'
  secure?: boolean
  maxAge?: number
}

/**
 * Parses a raw cookie string (the shape of `document.cookie`) into a Map of
 * decoded name → value. Splitting happens BEFORE decoding so encoded `;` and
 * `=` characters inside a value don't break the parser.
 */
export const parseCookies = (cookieString: string): Map<string, string> => {
  const out = new Map<string, string>()
  if (!cookieString) return out

  for (const rawPair of cookieString.split(';')) {
    const pair = rawPair.trim()
    if (!pair) continue
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    const name = decodeMaybe(pair.slice(0, eq).trim())
    const value = decodeMaybe(pair.slice(eq + 1).trim())
    if (name) out.set(name, value)
  }
  return out
}

const decodeMaybe = (input: string): string => {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

/**
 * Builds a `name=value; Attr=...` string suitable for assignment to
 * `document.cookie`. Encodes name and value per RFC 6265 and forces `Secure`
 * when `SameSite=None` (browsers reject the cookie otherwise).
 */
export const serializeCookie = (
  name: string,
  value: string,
  attrs: CookieAttributes
): string => {
  let out = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`

  if (attrs.maxAge !== undefined) out += `; Max-Age=${attrs.maxAge}`
  if (attrs.domain) out += `; Domain=${attrs.domain}`
  if (attrs.path) out += `; Path=${attrs.path}`
  if (attrs.sameSite) out += `; SameSite=${attrs.sameSite}`

  // `SameSite=None` only works with Secure; emit Secure even if the caller
  // forgot it so the browser doesn't silently drop the cookie.
  const needsSecure = attrs.secure === true || attrs.sameSite === 'None'
  if (needsSecure) out += '; Secure'

  return out
}

/**
 * Builds the cookie string that clears `name`. Browsers will only remove a
 * cookie when the deletion attributes (Domain, Path, SameSite, Secure) match
 * those used at write time, so we mirror them here.
 */
export const serializeCookieRemoval = (
  name: string,
  attrs: CookieAttributes
): string =>
  serializeCookie(name, '', {
    domain: attrs.domain,
    path: attrs.path,
    sameSite: attrs.sameSite,
    secure: attrs.secure,
    maxAge: 0
  })
