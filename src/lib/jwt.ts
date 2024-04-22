import { decodeBase64URL } from "./helpers";

/**
 * @ignore
 */
export interface JWTVerifyOptions {
  iss: string;
  aud: string;
  id_token: string;
  nonce?: string;
  leeway?: number;
  max_age?: number;
  organizationId?: string;
  now?: number;
}

export interface IdToken {
  __raw: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  middle_name?: string;
  nickname?: string;
  preferred_username?: string;
  profile?: string;
  picture?: string;
  website?: string;
  email?: string;
  email_verified?: boolean;
  gender?: string;
  birthdate?: string;
  zoneinfo?: string;
  locale?: string;
  phone_number?: string;
  phone_number_verified?: boolean;
  address?: string;
  updated_at?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  azp?: string;
  nonce?: string;
  auth_time?: string;
  at_hash?: string;
  c_hash?: string;
  acr?: string;
  amr?: string;
  sub_jwk?: string;
  cnf?: string;
  sid?: string;
  org_id?: string;
  [key: string]: any;
}

const isNumber = (n: any) => typeof n === "number";

const idTokendecoded = [
  "iss",
  "aud",
  "exp",
  "nbf",
  "iat",
  "jti",
  "azp",
  "nonce",
  "auth_time",
  "at_hash",
  "c_hash",
  "acr",
  "amr",
  "sub_jwk",
  "cnf",
  "sip_from_tag",
  "sip_date",
  "sip_callid",
  "sip_cseq_num",
  "sip_via_branch",
  "orig",
  "dest",
  "mky",
  "events",
  "toe",
  "txn",
  "rph",
  "sid",
  "vot",
  "vtm",
];

export function decodeJWTPayload(token: string) {
  // Regex checks for base64url format
  const base64UrlRegex =
    /^([a-z0-9_-]{4})*($|[a-z0-9_-]{3}=?$|[a-z0-9_-]{2}(==)?$)$/i;

  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error("JWT is not valid: not a JWT structure");
  }

  if (!base64UrlRegex.test(parts[1])) {
    throw new Error("JWT is not valid: payload is not in base64url format");
  }

  const base64Url = parts[1];
  return JSON.parse(decodeBase64URL(base64Url));
}

export const verify = (options: JWTVerifyOptions) => {
  if (!options.id_token) {
    throw new Error("ID token is required but missing");
  }

  const decoded = decodeJWTPayload(options.id_token);

  if (!decoded.claims.iss) {
    throw new Error(
      "Issuer (iss) claim must be a string present in the ID token"
    );
  }

  if (decoded.claims.iss !== options.iss) {
    throw new Error(
      `Issuer (iss) claim mismatch in the ID token; expected "${options.iss}", found "${decoded.claims.iss}"`
    );
  }

  if (!decoded.user.sub) {
    throw new Error(
      "Subject (sub) claim must be a string present in the ID token"
    );
  }

  if (decoded.header.alg !== "RS256") {
    throw new Error(
      `Signature algorithm of "${decoded.header.alg}" is not supported. Expected the ID token to be signed with "RS256".`
    );
  }

  if (
    !decoded.claims.aud ||
    !(
      typeof decoded.claims.aud === "string" ||
      Array.isArray(decoded.claims.aud)
    )
  ) {
    throw new Error(
      "Audience (aud) claim must be a string or array of strings present in the ID token"
    );
  }
  if (Array.isArray(decoded.claims.aud)) {
    if (!decoded.claims.aud.includes(options.aud)) {
      throw new Error(
        `Audience (aud) claim mismatch in the ID token; expected "${
          options.aud
        }" but was not one of "${decoded.claims.aud.join(", ")}"`
      );
    }
    if (decoded.claims.aud.length > 1) {
      if (!decoded.claims.azp) {
        throw new Error(
          "Authorized Party (azp) claim must be a string present in the ID token when Audience (aud) claim has multiple values"
        );
      }
      if (decoded.claims.azp !== options.aud) {
        throw new Error(
          `Authorized Party (azp) claim mismatch in the ID token; expected "${options.aud}", found "${decoded.claims.azp}"`
        );
      }
    }
  } else if (decoded.claims.aud !== options.aud) {
    throw new Error(
      `Audience (aud) claim mismatch in the ID token; expected "${options.aud}" but found "${decoded.claims.aud}"`
    );
  }
  if (options.nonce) {
    if (!decoded.claims.nonce) {
      throw new Error(
        "Nonce (nonce) claim must be a string present in the ID token"
      );
    }
    if (decoded.claims.nonce !== options.nonce) {
      throw new Error(
        `Nonce (nonce) claim mismatch in the ID token; expected "${options.nonce}", found "${decoded.claims.nonce}"`
      );
    }
  }

  if (options.max_age && !isNumber(decoded.claims.auth_time)) {
    throw new Error(
      "Authentication Time (auth_time) claim must be a number present in the ID token when Max Age (max_age) is specified"
    );
  }

  /* c8 ignore next 5 */
  if (decoded.claims.exp == null || !isNumber(decoded.claims.exp)) {
    throw new Error(
      "Expiration Time (exp) claim must be a number present in the ID token"
    );
  }
  if (!isNumber(decoded.claims.iat)) {
    throw new Error(
      "Issued At (iat) claim must be a number present in the ID token"
    );
  }

  const leeway = options.leeway || 60;
  const now = new Date(options.now || Date.now());
  const expDate = new Date(0);

  expDate.setUTCSeconds(decoded.claims.exp + leeway);

  if (now > expDate) {
    throw new Error(
      `Expiration Time (exp) claim error in the ID token; current time (${now}) is after expiration time (${expDate})`
    );
  }

  if (decoded.claims.nbf != null && isNumber(decoded.claims.nbf)) {
    const nbfDate = new Date(0);
    nbfDate.setUTCSeconds(decoded.claims.nbf - leeway);
    if (now < nbfDate) {
      throw new Error(
        `Not Before time (nbf) claim in the ID token indicates that this token can't be used just yet. Current time (${now}) is before ${nbfDate}`
      );
    }
  }

  if (decoded.claims.auth_time != null && isNumber(decoded.claims.auth_time)) {
    const authTimeDate = new Date(0);
    authTimeDate.setUTCSeconds(
      parseInt(decoded.claims.auth_time) + (options.max_age as number) + leeway
    );

    if (now > authTimeDate) {
      throw new Error(
        `Authentication Time (auth_time) claim in the ID token indicates that too much time has passed since the last end-user authentication. Current time (${now}) is after last auth at ${authTimeDate}`
      );
    }
  }

  if (options.organizationId) {
    if (!decoded.claims.org_id) {
      throw new Error(
        "Organization ID (org_id) claim must be a string present in the ID token"
      );
    } else if (options.organizationId !== decoded.claims.org_id) {
      throw new Error(
        `Organization ID (org_id) claim mismatch in the ID token; expected "${options.organizationId}", found "${decoded.claims.org_id}"`
      );
    }
  }

  return decoded;
};
