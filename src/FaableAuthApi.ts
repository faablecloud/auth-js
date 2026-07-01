import { BaseLog, BaseLogOptions } from './BaseLog'
import { AuthError } from './lib/errors'
import { _get } from './lib/fetch'

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
    credentials?: RequestCredentials
  }): Promise<{ data: null; error: AuthError | null }> {
    const url = `${this.base_url}/logout?${new URLSearchParams(params)}`
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
}
