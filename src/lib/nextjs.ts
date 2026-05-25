import { STORAGE_KEY } from './constants'
import { Session } from './types'

/**
 * Helper for Next.js (and any other SSR runtime) to read the session from
 * cookies on the server. Mirrors how the browser client builds the storage
 * key and reassembles chunked cookies written by `cookieStorageAdapter`,
 * so the integrator only needs to pass their `clientId`.
 *
 * The first argument can be the result of `cookies()` from `next/headers`,
 * or any plain object whose keys are cookie names.
 */
export const getSessionFromCookies = (
  cookiesStore: any,
  options: { clientId: string; storageKey?: string }
): Session | null => {
  const key = `${options.storageKey ?? STORAGE_KEY}-${options.clientId}`

  const cookieValue = readCookieValue(cookiesStore, key)
  if (!cookieValue) return null

  try {
    return JSON.parse(decodeURIComponent(cookieValue))
  } catch (e) {
    console.error('Failed to parse session from cookie', e)
    return null
  }
}

/**
 * Reads `key` (or its `<key>.0`, `<key>.1`, … chunks) out of either a Next.js
 * `cookies()` object or a plain `{ name: value }` map, mirroring how the
 * browser adapter writes them.
 */
const readCookieValue = (cookiesStore: any, key: string): string | null => {
  if (!cookiesStore) return null

  const readOne =
    typeof cookiesStore.get === 'function'
      ? (name: string) => cookiesStore.get(name)?.value
      : (name: string) => cookiesStore[name]

  const single = readOne(key)
  if (single) return single

  const chunks: string[] = []
  for (let i = 0; ; i++) {
    const value = readOne(`${key}.${i}`)
    if (!value) break
    chunks.push(value)
  }
  return chunks.length ? chunks.join('') : null
}
