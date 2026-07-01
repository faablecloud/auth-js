import { AuthError } from './errors'

/**
 * Converts a `{ data, error }` result from any {@link FaableAuthClient} method
 * into throw-style control flow: returns `data` on success, throws the
 * {@link AuthError} on failure.
 *
 * Every async method on the client follows the never-throw contract — expected
 * failures resolve in `error` rather than rejecting. That is the right default
 * for most UIs, but when you'd rather let an error propagate (a server handler,
 * a `try/catch`, a wrapper that normalizes everything to throws), `unwrap`
 * saves you from hand-writing `if (error) throw error` at every call site.
 *
 * @example
 * ```ts
 * import { unwrap } from '@faable/auth-js'
 *
 * // throws AuthError on a wrong OTP instead of returning { error }
 * const { session } = unwrap(await auth.signInWithOtp({ username, otp }))
 * ```
 *
 * @param result Any `{ data, error }` result returned by the client.
 * @returns The `data` payload when `error` is `null`.
 * @throws {AuthError} The `error` from the result when it is non-null.
 */
export function unwrap<Data>(result: {
  data: Data
  error: AuthError | null
}): Data {
  if (result.error) {
    throw result.error
  }
  return result.data
}
