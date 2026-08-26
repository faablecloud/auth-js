import { fetch } from './globals'
import { version } from './version'

export type JsonResponse<T = any> = {
  data: T | null
  error?: any
  /**
   * HTTP status of the response, when there was one. Callers that turn a
   * failed response into an AuthError need it — reading it back out of the
   * body only works for servers that happen to echo it there.
   */
  status?: number
}

type RequestInitWithToken = RequestInit & {
  token: string
  raw: boolean
}

const headers = (init: Partial<RequestInitWithToken> = {}) => {
  // Identify ourselves as a first-party client so the auth server can tell
  // auth-js (browser OAuth SDK) traffic apart from the dashboard, the
  // management SDK, or third-party integrations. Format: `<name>/<version>`
  // (version injected at release time).
  let headers: Record<string, string> = {
    'x-faable-client': `auth-js/${version}`
  }
  if (init?.token) {
    headers = { ...headers, Authorization: `Bearer ${init?.token}` }
  }
  return {
    ...init?.headers,
    ...headers
  }
}

/**
 * Human-readable reason out of an error body, across the two shapes this API
 * speaks.
 *
 * `/oauth/token` answers RFC 6749 §5.2: `{ error, error_description? }`, where
 * `error` is the OAuth code — or the message itself when the thrower set no
 * code. Everything else answers the http-errors shape:
 * `{ statusCode, error: 'Unauthorized', message }`.
 *
 * Reading `message` alone (as this did) meant the token endpoint's reason was
 * ALWAYS dropped: a rejected OTP arrives as `{"error":"Invalid or expired
 * OTP"}` and produced no error at all. `error` is read last on purpose — in the
 * http-errors shape it holds the status name, which is noise next to `message`.
 */
const _errorMessage = (body: unknown): string | undefined => {
  if (typeof body === 'string') return body || undefined
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>
  for (const key of ['error_description', 'message', 'error']) {
    const value = b[key]
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

const _handleRes = async (
  res: Response,
  options: Partial<RequestInitWithToken> = {}
) => {
  const body = options.raw ? await res.text() : await res.json()
  if (res.status >= 300) {
    let parsed: unknown = body
    if (options.raw) {
      try {
        parsed = JSON.parse(body)
      } catch {
        parsed = body
      }
    }
    return {
      data: body,
      // Never let a failed response come back with a falsy error: callers
      // branch on it, and an empty one sends them down the success path.
      error:
        _errorMessage(parsed) ?? `Request failed with status ${res.status}`,
      status: res.status
    }
  }
  return { data: body, error: null, status: res.status }
}

export const _post = async <T>(
  url: string,
  data: object,
  options: Partial<RequestInitWithToken> = {}
): Promise<JsonResponse<T>> => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { ...headers(options), 'Content-Type': 'application/json' }
    })

    return await _handleRes(res, options)
  } catch (e) {
    return { data: null, error: e }
  }
}

export const _get = async <T>(
  url: string,
  options: Partial<RequestInitWithToken> = {}
): Promise<JsonResponse<T>> => {
  try {
    const res = await fetch(url, {
      ...options,
      method: 'GET',
      headers: headers(options)
    })

    return await _handleRes(res, options)
  } catch (e) {
    return { data: null, error: e }
  }
}
