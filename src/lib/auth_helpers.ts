/**
 * Picks the OAuth `response_type` for an authorize request.
 *
 * Browsers default to the authorization code flow (PKCE); non-browser
 * environments default to the implicit token flow. A caller-provided
 * value always wins.
 */
export const resolveResponseType = (
  options: { response_type?: string },
  isBrowserEnv: boolean
): string => options.response_type || (isBrowserEnv ? 'code' : 'token')

/**
 * Renders an HTML form returned by the authorization server and submits it,
 * triggering the browser navigation that completes the username/password
 * login flow.
 */
export const buildAndSubmitForm = (formHtml: string, doc: Document): void => {
  const div = doc.createElement('div')
  div.innerHTML = formHtml
  const form = doc.body.appendChild(div).children[0] as
    | HTMLFormElement
    | undefined
  if (!form) {
    throw new Error('Auth response did not contain a submittable form')
  }
  form.submit()
}
