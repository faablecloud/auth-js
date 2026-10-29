import { BaseLog, BaseLogOptions } from './BaseLog'
import { AuthApiError, AuthError, AuthRetryableFetchError } from './lib/errors'
import { JsonResponse, _delete, _get, _patch, _post } from './lib/fetch'
import { ProfileUpdate, User, UserCredentials, UserSessions } from './lib/types'

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
   * Turns a fetch result into `{ data, error }`. No status means the request
   * never completed — not a verdict, so the caller may retry. A status is the
   * server's answer, with its stable `error_code`.
   */
  private _result<T>(res: JsonResponse<T>): {
    data: T | null
    error: AuthError | null
  } {
    this._debug(res)
    if (res.error) {
      const message =
        res.error instanceof Error ? res.error.message : String(res.error)
      const error =
        res.status === undefined
          ? new AuthRetryableFetchError(message, 0)
          : new AuthApiError(message, res.status, res.code)
      return { data: null, error }
    }
    return { data: res.data, error: null }
  }

  /** `GET /me/credentials` — whether the user has a password, and their connections. */
  async getCredentials({ access_token }: { access_token: string }) {
    const url = `${this.base_url}/me/credentials`
    this._debug(`requesting ${url}`)
    return this._result(
      await _get<UserCredentials>(url, { token: access_token })
    )
  }

  /** `POST /me/password` — set or change the user's own password. */
  async setPassword({
    access_token,
    password,
    current_password
  }: {
    access_token: string
    password: string
    current_password?: string
  }) {
    const url = `${this.base_url}/me/password`
    this._debug(`requesting ${url}`)
    return this._result(
      await _post<{ revoked_sessions: number }>(
        url,
        { password, ...(current_password ? { current_password } : {}) },
        { token: access_token }
      )
    )
  }

  /** `PATCH /me` — the user's own profile: name, company, country, fields. */
  async updateProfile({
    access_token,
    ...profile
  }: { access_token: string } & ProfileUpdate) {
    const url = `${this.base_url}/me`
    this._debug(`requesting ${url}`)
    return this._result(
      await _patch<User>(url, profile, { token: access_token })
    )
  }

  /** `GET /me/sessions` — the user's active sessions, newest first. */
  async listSessions({ access_token }: { access_token: string }) {
    const url = `${this.base_url}/me/sessions`
    this._debug(`requesting ${url}`)
    return this._result(await _get<UserSessions>(url, { token: access_token }))
  }

  /** `DELETE /me/identities/:connection_id` — unlink a social account. */
  async unlinkIdentity({
    access_token,
    connection_id
  }: {
    access_token: string
    connection_id: string
  }) {
    const url = `${this.base_url}/me/identities/${encodeURIComponent(connection_id)}`
    this._debug(`requesting ${url}`)
    return this._result(
      await _delete<{ unlinked: number }>(url, { token: access_token })
    )
  }

  /** `DELETE /me` — delete the user's own account (204). */
  async deleteAccount({ access_token }: { access_token: string }) {
    const url = `${this.base_url}/me`
    this._debug(`requesting ${url}`)
    return this._result(await _delete<null>(url, { token: access_token }))
  }

  /**
   * `POST /oauth/revoke` (RFC 7009) — revokes a refresh token issued to this
   * public client. The server answers 200 for an unknown or foreign token too,
   * so only a client that fails to authenticate gets an error.
   */
  async revokeToken({
    token,
    client_id
  }: {
    token: string
    client_id: string
  }): Promise<{ error: AuthError | null }> {
    const url = `${this.base_url}/oauth/revoke`
    this._debug(`requesting ${url}`)
    const res = await _post(url, {
      token,
      token_type_hint: 'refresh_token',
      client_id
    })
    this._debug(res)
    if (res.error) {
      const message =
        res.error instanceof Error ? res.error.message : String(res.error)
      const error =
        res.status === undefined
          ? new AuthRetryableFetchError(message, 0)
          : new AuthApiError(message, res.status, res.code)
      return { error }
    }
    return { error: null }
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
