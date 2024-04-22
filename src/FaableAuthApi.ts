import { AuthError } from "./lib/errors";

export default class FaableAuthApi {
  async signOut(): Promise<{ data: null; error: AuthError | null }> {
    return { data: null, error: null };
  }
}
