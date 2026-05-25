/**
 * Races a promise against a deadline. If `promise` settles first the result
 * passes through; if the deadline elapses first the returned promise rejects
 * with an Error whose message is `timeoutMessage`. The internal timer is
 * cleared once `promise` settles, regardless of outcome.
 */
export const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    }),
    timeoutPromise
  ])
}
