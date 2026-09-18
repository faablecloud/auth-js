/**
 * Extracts parameters encoded in the URL both in the query and fragment.
 */
export function parseParametersFromURL(href: string = '') {
  const result: { [parameter: string]: string } = {}

  const url = new URL(href)

  if (url.hash && url.hash[0] === '#') {
    try {
      const hashSearchParams = new URLSearchParams(url.hash.substring(1))
      hashSearchParams.forEach((value, key) => {
        result[key] = value
      })
    } catch (_e) {
      // hash is not a query string
    }
  }

  // search parameters take precedence over hash parameters
  url.searchParams.forEach((value, key) => {
    result[key] = value
  })

  return result
}

/**
 * What a finished PKCE callback has to wipe from the address bar.
 *
 * `state` is conditional, and the condition is the whole point. An app that
 * put its own `state` in the authorize URL is entitled to read it back on
 * landing — that is what `state` is FOR, and at least one app does exactly
 * that (CORE encodes a JSON in it and decodes it from `window.location` on
 * SIGNED_IN). Wiping it would silently break them.
 *
 * A `state` we never asked for is another matter: it can only have been put
 * there by the server, and until 2026-09-18 what it put there was an internal
 * StateStore key (see arch/auth/oauth-state-internal-key-leak.md). The server
 * no longer does that; this is the second lock on the same door, so that no
 * future server path can leave a handle of ours in someone's URL.
 */
export const callbackParamsToClear = ({
  sentState = false
}: { sentState?: boolean } = {}): string[] =>
  sentState ? ['code', 'signup'] : ['code', 'signup', 'state']

export const clearURLParameters = (delete_params: string[] = []) => {
  const url = new URL(window.location.href)

  delete_params.forEach(param => {
    url.searchParams.delete(param)
  })

  url.hash = ''

  window.history.replaceState(window.history.state, '', url.toString())
}
