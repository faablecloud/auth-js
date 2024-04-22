import { FaableAuthClient } from "./FaableAuthClient";
import { FaableAuthClientConfig } from "./lib/types";
import { Session, User } from "./lib/types";
export const createClient = (config: FaableAuthClientConfig) => {
  return new FaableAuthClient(config);
};

export { Session, User };
