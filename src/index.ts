import { FaableAuthClient } from "./FaableAuthClient";
import { FaableAuthClientConfig } from "./lib/types";
import { Session, User } from "./lib/types";
import { AuthError } from "./lib/errors";

export const createClient = (config: FaableAuthClientConfig) => {
  return new FaableAuthClient(config);
};

export { Session, User, FaableAuthClient, AuthError };
