import { BaseLog, BaseLogOptions } from "./BaseLog";
import { AuthError } from "./lib/errors";
import { _get } from "./lib/fetch";

export default class FaableAuthApi extends BaseLog {
  constructor(public base_url: string, config: BaseLogOptions) {
    super(config);
  }
  protected extraPrint(): string {
    return "api";
  }

  async signOut(params: {
    client_id: string;
  }): Promise<{ data: null; error: AuthError | null }> {
    const url = `${this.base_url}/logout?${new URLSearchParams(params)}`;
    this._debug(`requesting ${url}`);
    const res = await _get(url);
    this._debug(res);
    if (res.error) {
      return { error: null, data: null };
    } else {
      return res;
    }
  }
}
