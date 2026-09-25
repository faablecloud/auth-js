import { BaseLog, BaseLogOptions } from './BaseLog'
import { AuthApiError, AuthError, AuthRetryableFetchError } from './lib/errors'
import { _get, _post } from './lib/fetch'

export default class FaableAuthApi extends BaseLog {
  constructor(
    public base_url: string,
    config: BaseLogOptions
  ) {
    super(config)
  }
  protected extraPrint(): string {
    return 'api'
  }

  async signOut({
    credentials,
    ...params
  }: {
    client_id: string
    returnTo?: string
    // OIDC RP-Initiated Logout §2 `id_token_hint`: the id_token of the
    // session being ended. A verified hint is what lets the tenant end the
    // session without asking the user to confirm
    // (`Account.logout_confirm_required`) — the redirect path already sends
    // it via `getLogoutUrl`; this is the same hint on the fetch-only path
    // (`signOut({ redirect: false })`, and every non-global scope).
    id_token_hint?: string
    credentials?: RequestCredentials
  }): Promise<{ data: null; error: AuthError | null }> {
    const definedParams = Object.fromEntries(
      Object.entries(params).filter(([, value]) => !!value)
    ) as Record<string, string>
    const url = `${this.base_url}/logout?${new URLSearchParams(definedParams)}`
    this._debug(`requesting ${url}`)
    // Send cookies so the /logout can clear the SSO cookie when the app and the
    // auth server share a site. Cross-site it is still blocked — a top-level
    // navigation (see FaableAuthClient.signOut) is the robust path.
    const res = await _get(url, credentials ? { credentials } : {})
    this._debug(res)
    if (res.error) {
      return { error: res.error, data: null }
    } else {
      return { error: null, data: null }
    }
  }

  /**
   * `POST /me/sessions/revoke-others` — ends every session of the user
   * except the one this access token belongs to. Refresh tokens issued in
   * the revoked sessions are refused on their next use; access and id
   * tokens already issued keep working until they expire.
   */
  async revokeOtherSessions({
    access_token
  }: {
    access_token: string
  }): Promise<{ data: { revoked: number } | null; error: AuthError | null }> {
    const url = `${this.base_url}/me/sessions/revoke-others`
    this._debug(`requesting ${url}`)
    const res = await _post<{ revoked: number }>(
      url,
      {},
      { token: access_token }
    )
    this._debug(res)
    if (res.error) {
      const message =
        res.error instanceof Error ? res.error.message : String(res.error)
      // No status → the request never completed; that is not a verdict on
      // the sessions, so the caller may retry. A status is the server's answer.
      const error =
        res.status === undefined
          ? new AuthRetryableFetchError(message, 0)
          : new AuthApiError(message, res.status, res.code)
      return { data: null, error }
    }
    return { data: res.data, error: null }
  }
}
