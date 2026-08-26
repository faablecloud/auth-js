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

const _handleRes = async (
  res: Response,
  options: Partial<RequestInitWithToken> = {}
) => {
  const body = options.raw ? await res.text() : await res.json()
  if (res.status >= 300) {
    return {
      data: body,
      error: options.raw ? JSON.parse(body)?.message : body?.message,
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
