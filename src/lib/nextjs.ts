import { STORAGE_KEY } from './constants'
import { Session } from './types'

/**
 * Helper for Next.js (and any other SSR runtime) to read the session from
 * cookies on the server. Mirrors how the browser client builds the storage
 * key, so the integrator only needs to pass their `clientId`.
 *
 * The first argument can be the result of `cookies()` from `next/headers`,
 * or any plain object whose keys are cookie names.
 */
export const getSessionFromCookies = (
  cookiesStore: any,
  options: { clientId: string; storageKey?: string }
): Session | null => {
  const key = `${options.storageKey ?? STORAGE_KEY}-${options.clientId}`

  let cookieValue: string | undefined
  if (typeof cookiesStore?.get === 'function') {
    cookieValue = cookiesStore.get(key)?.value
  } else {
    cookieValue = cookiesStore?.[key]
  }

  if (!cookieValue) return null

  try {
    return JSON.parse(decodeURIComponent(cookieValue))
  } catch (e) {
    console.error('Failed to parse session from cookie', e)
    return null
  }
}
