import { STORAGE_KEY } from './constants'
import { Session } from './types'

/**
 * Reads the persisted session from cookies on the server.
 *
 * Pair this with the cookie storage adapter on the client: when the browser
 * stores its session under the cookie shared with the server, the same
 * `clientId` lets the server reconstruct it. Mirrors how the browser
 * adapter builds the storage key and reassembles chunked cookies, so no
 * extra wiring is required.
 *
 * @param cookiesStore Either the result of `cookies()` from `next/headers`,
 *   or any plain `{ name: value }` map. Adapters with a `get(name)` method
 *   are detected automatically.
 * @param options `{ clientId, storageKey? }`. `storageKey` defaults to the
 *   library's built-in prefix — only set it when you customized
 *   `storageKey` in `createClient`.
 * @returns The decoded {@link Session} or `null` when the cookie is absent
 *   or malformed.
 * @example
 * ```ts
 * // app/page.tsx
 * import { cookies } from 'next/headers'
 * import { getSessionFromCookies } from '@faable/auth-js'
 *
 * export default async function Page() {
 *   const session = getSessionFromCookies(cookies(), {
 *     clientId: '<client_id>'
 *   })
 *   if (!session) return <SignIn />
 *   return <Dashboard user={session.user} />
 * }
 * ```
 * @see {@link https://faable.com/docs/auth/quickstart/nextjs | Next.js Quickstart}
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
