import { AuthApiError } from './errors'
import { JsonResponse } from './fetch'
import { saveCodeVerifier } from './pkce_storage'
import { AuthResponse, SupportedStorage, User } from './types'

function dec2hex(dec: number) {
  return ('0' + dec.toString(16)).substr(-2)
}

export function decodeBase64URL(value: string): string {
  const key =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
  let base64 = ''
  let chr1, chr2, chr3
  let enc1, enc2, enc3, enc4
  let i = 0
  value = value.replace('-', '+').replace('_', '/')

  while (i < value.length) {
    enc1 = key.indexOf(value.charAt(i++))
    enc2 = key.indexOf(value.charAt(i++))
    enc3 = key.indexOf(value.charAt(i++))
    enc4 = key.indexOf(value.charAt(i++))
    chr1 = (enc1 << 2) | (enc2 >> 4)
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2)
    chr3 = ((enc3 & 3) << 6) | enc4
    base64 = base64 + String.fromCharCode(chr1)

    if (enc3 != 64 && chr2 != 0) {
      base64 = base64 + String.fromCharCode(chr2)
    }
    if (enc4 != 64 && chr3 != 0) {
      base64 = base64 + String.fromCharCode(chr3)
    }
  }
  return base64
}

export function generatePKCEVerifier() {
  if (
    typeof crypto === 'undefined' ||
    typeof crypto.getRandomValues !== 'function'
  ) {
    throw new Error(
      'Web Crypto API is required to generate a PKCE code verifier'
    )
  }
  const verifierLength = 56
  const array = new Uint32Array(verifierLength)
  crypto.getRandomValues(array)
  return Array.from(array, dec2hex).join('')
}

async function sha256(randomString: string) {
  const encoder = new TextEncoder()
  const encodedData = encoder.encode(randomString)
  const hash = await crypto.subtle.digest('SHA-256', encodedData)
  const bytes = new Uint8Array(hash)

  return Array.from(bytes)
    .map(c => String.fromCharCode(c))
    .join('')
}

function base64urlencode(str: string) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function generatePKCEChallenge(verifier: string) {
  const hasCryptoSupport =
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof TextEncoder !== 'undefined'

  if (!hasCryptoSupport) {
    console.warn(
      'WebCrypto API is not supported. Code challenge method will default to use plain instead of sha256.'
    )
    return verifier
  }
  const hashed = await sha256(verifier)
  return base64urlencode(hashed)
}

export async function getCodeChallengeAndMethod(
  storage: SupportedStorage,
  storageKey: string,
  isPasswordRecovery = false,
  returnTo?: string
) {
  const codeVerifier = generatePKCEVerifier()
  await saveCodeVerifier(storage, `${storageKey}-code-verifier`, {
    verifier: codeVerifier,
    redirectType: isPasswordRecovery ? 'PASSWORD_RECOVERY' : undefined,
    returnTo
  })
  const codeChallenge = await generatePKCEChallenge(codeVerifier)
  const codeChallengeMethod = codeVerifier === codeChallenge ? 'plain' : 'S256'
  return [codeChallenge, codeChallengeMethod]
}

export const isBrowser = () => typeof document !== 'undefined'

const localStorageWriteTests = {
  tested: false,
  writable: false
}

/**
 * Checks whether localStorage is supported on this browser.
 */
export const supportsLocalStorage = () => {
  if (!isBrowser()) {
    return false
  }

  try {
    if (typeof globalThis.localStorage !== 'object') {
      return false
    }
  } catch (_e) {
    // DOM exception when accessing `localStorage`
    return false
  }

  if (localStorageWriteTests.tested) {
    return localStorageWriteTests.writable
  }

  const randomKey = `lswt-${Math.random()}${Math.random()}`

  try {
    globalThis.localStorage.setItem(randomKey, randomKey)
    globalThis.localStorage.removeItem(randomKey)

    localStorageWriteTests.tested = true
    localStorageWriteTests.writable = true
  } catch (_e) {
    // localStorage can't be written to
    // https://www.chromium.org/for-testers/bug-reporting-guidelines/uncaught-securityerror-failed-to-read-the-localstorage-property-from-window-access-is-denied-for-this-document

    localStorageWriteTests.tested = true
    localStorageWriteTests.writable = false
  }

  return localStorageWriteTests.writable
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c == 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export type RawAuthResponse = {
  expires_at: number
  expires_in: number
  user: User
  access_token: string
  refresh_token: string
  token_type: string
}
/**
 * hasSession checks if the response object contains a valid session
 * @param data A response object
 * @returns true if a session is in the response
 */
function hasSession(data: Partial<RawAuthResponse>): data is RawAuthResponse {
  return !!data.access_token && !!data.refresh_token && !!data.expires_in
}

export function expiresAt(expiresIn: number) {
  const timeNow = Math.round(Date.now() / 1000)
  return timeNow + expiresIn
}

export function _sessionResponse({
  data,
  error,
  status,
  code
}: JsonResponse<Partial<RawAuthResponse>>): AuthResponse {
  // Forward what the server actually said. This used to destructure `data`
  // alone and hardcode `error: null`, which made the `if (error)` branch in
  // every caller dead code: a 401 "Invalid or expired OTP", a 429, an action
  // deny — all of them fell through to the generic
  // AuthInvalidTokenResponseError ("Auth session or user missing"), so the one
  // piece of information the user needed never reached the screen.
  if (error) {
    const body = (data ?? {}) as Record<string, unknown>
    const message =
      typeof error === 'string'
        ? error
        : ((error as { message?: string })?.message ?? String(error))
    return {
      data: { session: null, user: null },
      // Callers read `error.message`, so the raw string the fetch layer
      // produces has to be wrapped — a bare string would silently render as
      // `undefined`. Fastify puts the status and the code in the error body.
      // Code precedence: the server's stable `error_code` (the contract UIs
      // branch on, e.g. `user_suspended`) over the RFC 6749 `error` (too
      // coarse — `invalid_grant` covers unrelated denials).
      error: new AuthApiError(
        message,
        status ?? (typeof body.statusCode === 'number' ? body.statusCode : 500),
        code ??
          (typeof body.error_code === 'string' ? body.error_code : undefined) ??
          (typeof body.error === 'string' ? body.error : undefined)
      )
    }
  }

  let session = null
  if (!data) throw new Error('Bad session response')
  if (hasSession(data)) {
    session = { ...data }
    if (!data.expires_at && data.expires_in) {
      session.expires_at = expiresAt(data.expires_in)
    }
  }

  const user: User = data.user ?? (data as User)
  return { data: { session, user }, error: null }
}

/**
 * A deferred represents some asynchronous work that is not yet finished, which
 * may or may not culminate in a value.
 * Taken from: https://github.com/mike-north/types/blob/master/src/async.ts
 */
export class Deferred<T = any> {
  public static promiseConstructor: PromiseConstructor = Promise

  public readonly promise!: PromiseLike<T>

  public readonly resolve!: (value?: T | PromiseLike<T>) => void

  public readonly reject!: (reason?: any) => any

  public constructor() {
    ;(this as any).promise = new Deferred.promiseConstructor((res, rej) => {
      ;(this as any).resolve = res
      ;(this as any).reject = rej
    })
  }
}

/**
 * Converts the provided async function into a retryable function. Each result
 * or thrown error is sent to the isRetryable function which should return true
 * if the function should run again.
 */
export function retryable<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (attempt: number, error: any | null, result?: T) => boolean
): Promise<T> {
  const promise = new Promise<T>((accept, reject) => {
    ;(async () => {
      for (let attempt = 0; attempt < Infinity; attempt++) {
        try {
          const result = await fn(attempt)

          if (!isRetryable(attempt, null, result)) {
            accept(result)
            return
          }
        } catch (e: any) {
          if (!isRetryable(attempt, e)) {
            reject(e)
            return
          }
        }
      }
    })()
  })

  return promise
}

/**
 * Creates a promise that resolves to null after some time.
 */
export async function sleep(time: number): Promise<null> {
  return new Promise(accept => {
    setTimeout(() => accept(null), time)
  })
}

export const checkExpiresInTime = ({
  expires_in,
  expires_at,
  refreshTick
}: {
  expires_in: string
  expires_at?: string
  refreshTick: number
}) => {
  const timeNow = Math.round(Date.now() / 1000)
  const expiresIn = parseInt(expires_in)
  let expiresAt = timeNow + expiresIn

  if (expires_at) {
    expiresAt = parseInt(expires_at)
  }

  const actuallyExpiresIn = expiresAt - timeNow
  if (actuallyExpiresIn * 1000 <= refreshTick) {
    console.warn(
      `@faable/auth-js: Session as retrieved from URL expires in ${actuallyExpiresIn}s, should have been closer to ${expiresIn}s`
    )
  }

  const issuedAt = expiresAt - expiresIn
  if (timeNow - issuedAt >= 120) {
    console.warn(
      '@faable/auth-js: Session as retrieved from URL was issued over 120s ago, URL could be stale',
      issuedAt,
      expiresAt,
      timeNow
    )
  } else if (timeNow - issuedAt < 0) {
    console.warn(
      '@faable/auth-js: Session as retrieved from URL was issued in the future? Check the device clok for skew',
      issuedAt,
      expiresAt,
      timeNow
    )
  }

  return { expiresIn, expiresAt }
}
