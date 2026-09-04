/**
 * Races a promise against a deadline. If `promise` settles first the result
 * passes through; if the deadline elapses first the returned promise rejects
 * with the error `onTimeout` builds. The internal timer is cleared once
 * `promise` settles, regardless of outcome.
 *
 * The error is supplied by the caller rather than built here, because a
 * timeout's CLASS is what decides how the caller's error handling treats it:
 * the one call site races a token refresh, where a plain `Error` fell outside
 * the SDK's `isAuthError` handling entirely and left the session in limbo.
 *
 * Note this races, it does not cancel: `promise` keeps running (and, for a
 * fetch, keeps the request open) after the deadline passes.
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs)
  })
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    }),
    timeoutPromise
  ])
}
