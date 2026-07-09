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
 * @param cookiesStore The result of `cookies()` from `next/headers`
 *   (Next.js 15+ returns a Promise — pass it directly or pre-awaited, both
 *   work), a `NextRequest.cookies` object (for `middleware.ts` / Edge), or any
 *   plain `{ name: value }` map. Adapters with a `get(name)` method are
 *   detected automatically.
 * @param options `{ clientId, storageKey? }`. `storageKey` defaults to the
 *   library's built-in prefix — only set it when you customized
 *   `storageKey` in `createClient`.
 * @returns The decoded {@link Session} or `null` when the cookie is absent or
 *   malformed. When `cookiesStore` is a Promise (Next.js 15 `cookies()`) the
 *   result is a Promise that resolves to the same; otherwise it is returned
 *   synchronously (Next.js ≤14). `await` works either way, so always `await`.
 * @example
 * ```ts
 * // app/page.tsx (Next.js 15 — cookies() is async)
 * import { cookies } from 'next/headers'
 * import { getSessionFromCookies } from '@faable/auth-js'
 *
 * export default async function Page() {
 *   const session = await getSessionFromCookies(await cookies(), {
 *     clientId: '<client_id>'
 *   })
 *   if (!session) return <SignIn />
 *   return <Dashboard user={session.user} />
 * }
 * ```
 * @example
 * ```ts
 * // middleware.ts — gate routes at the edge before any HTML is sent
 * import { NextRequest, NextResponse } from 'next/server'
 * import { getSessionFromCookies } from '@faable/auth-js'
 *
 * export async function middleware(req: NextRequest) {
 *   const session = await getSessionFromCookies(req.cookies, {
 *     clientId: '<client_id>'
 *   })
 *   if (!session) return NextResponse.redirect(new URL('/login', req.url))
 *   return NextResponse.next()
 * }
 * ```
 * @see {@link https://faable.com/docs/auth/quickstart/nextjs | Next.js Quickstart}
 */
export function getSessionFromCookies(
  cookiesStore: Promise<unknown>,
  options: { clientId: string; storageKey?: string }
): Promise<Session | null>
export function getSessionFromCookies(
  cookiesStore: unknown,
  options: { clientId: string; storageKey?: string }
): Session | null
export function getSessionFromCookies(
  cookiesStore: any,
  options: { clientId: string; storageKey?: string }
): Session | null | Promise<Session | null> {
  // Next.js 15 made `cookies()` async: it returns a Promise, so callers may
  // pass it un-awaited. When given a thenable we resolve it and return a
  // Promise; otherwise we stay synchronous so existing Next.js ≤14 callers
  // (which relied on the sync return) keep working unchanged. `await` works
  // on both shapes, so the recommended `await getSessionFromCookies(...)` is
  // always correct.
  if (cookiesStore && typeof cookiesStore.then === 'function') {
    return (cookiesStore as Promise<unknown>).then(store =>
      parseSession(store, options)
    )
  }
  return parseSession(cookiesStore, options)
}

const parseSession = (
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
