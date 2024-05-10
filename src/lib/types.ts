import { AuthError } from "./errors";
import { LockFunc } from "../lock/locks";
import { BaseLogOptions } from "../BaseLog";

/**
 * @ignore
 */
export interface AuthenticationResult {
  state: string;
  code?: string;
  error?: string;
  error_description?: string;
}

export class User {
  name?: string;
  profile?: string;
  picture?: string;
  email?: string;
  website?: string;
  birthdate?: string;
  locale?: string;
  sub?: string;
  [key: string]: any;
}

/**
 * The state of the application before the user was redirected to the login page.
 */
export type AppState = {
  returnTo?: string;
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export interface AuthorizationParams {
  /**
   * - `'page'`: displays the UI with a full page view
   * - `'popup'`: displays the UI with a popup window
   * - `'touch'`: displays the UI in a way that leverages a touch interface
   * - `'wap'`: displays the UI with a "feature phone" type interface
   */
  display?: "page" | "popup" | "touch" | "wap";

  /**
   * - `'none'`: do not prompt user for login or consent on reauthentication
   * - `'login'`: prompt user for reauthentication
   * - `'consent'`: prompt user for consent before processing request
   * - `'select_account'`: prompt user to select an account
   */
  prompt?: "none" | "login" | "consent" | "select_account";

  /**
   * Maximum allowable elapsed time (in seconds) since authentication.
   * If the last time the user authenticated is greater than this value,
   * the user must be reauthenticated.
   */
  max_age?: string | number;

  /**
   * The space-separated list of language tags, ordered by preference.
   * For example: `'fr-CA fr en'`.
   */
  ui_locales?: string;

  /**
   * Previously issued ID Token.
   */
  id_token_hint?: string;

  /**
   * Provides a hint to Auth0 as to what flow should be displayed.
   * The default behavior is to show a login page but you can override
   * this by passing 'signup' to show the signup page instead.
   *
   * This only affects the New Universal Login Experience.
   */
  screen_hint?: "signup" | "login" | string;

  /**
   * The user's email address or other identifier. When your app knows
   * which user is trying to authenticate, you can provide this parameter
   * to pre-fill the email box or select the right session for sign-in.
   *
   * This currently only affects the classic Lock experience.
   */
  login_hint?: string;

  acr_values?: string;

  /**
   * The default scope to be used on authentication requests.
   *
   * This defaults to `profile email` if not set. If you are setting extra scopes and require
   * `profile` and `email` to be included then you must include them in the provided scope.
   *
   * Note: The `openid` scope is **always applied** regardless of this setting.
   */
  scope?: string;

  /**
   * The default audience to be used for requesting API access.
   */
  audience?: string;

  /**
   * The name of the connection configured for your application.
   * If null, it will redirect to the Auth0 Login Page and show
   * the Login Widget.
   */
  connection?: string;

  /**
   * The Id of an organization to log in to.
   *
   * This will specify an `organization` parameter in your user's login request and will add a step to validate
   * the `org_id` claim in your user's ID Token.
   */
  organization?: string;

  /**
   * The Id of an invitation to accept. This is available from the user invitation URL that is given when participating in a user invitation flow.
   */
  invitation?: string;

  /**
   * The default URL where Auth0 will redirect your browser to with
   * the authentication result. It must be whitelisted in
   * the "Allowed Callback URLs" field in your Auth0 Application's
   * settings. If not provided here, it should be provided in the other
   * methods that provide authentication.
   */
  redirect_uri?: string;

  /**
   * If you need to send custom parameters to the Authorization Server,
   * make sure to use the original parameter name.
   */
  [key: string]: any;
}

interface BaseLoginOptions {
  /**
   * URL parameters that will be sent back to the Authorization Server. This can be known parameters
   * defined by Auth0 or custom parameters that you define.
   */
  authorizationParams?: AuthorizationParams;
}

export interface RedirectLoginOptions<TAppState = any>
  extends BaseLoginOptions {
  /**
   * Used to store state before doing the redirect
   */
  appState?: TAppState;
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

export interface GetTokenSilentlyOptions {
  /**
   * When `off`, ignores the cache and always sends a
   * request to Auth0.
   * When `cache-only`, only reads from the cache and never sends a request to Auth0.
   * Defaults to `on`, where it both reads from the cache and sends a request to Auth0 as needed.
   */
  cacheMode?: "on" | "off" | "cache-only";

  /**
   * Parameters that will be sent back to Auth0 as part of a request.
   */
  authorizationParams?: {
    /**
     * There's no actual redirect when getting a token silently,
     * but, according to the spec, a `redirect_uri` param is required.
     * Auth0 uses this parameter to validate that the current `origin`
     * matches the `redirect_uri` `origin` when sending the response.
     * It must be whitelisted in the "Allowed Web Origins" in your
     * Auth0 Application's settings.
     */
    redirect_uri?: string;

    /**
     * The scope that was used in the authentication request
     */
    scope?: string;

    /**
     * The audience that was used in the authentication request
     */
    audience?: string;

    /**
     * If you need to send custom parameters to the Authorization Server,
     * make sure to use the original parameter name.
     */
    [key: string]: any;
  };

  /** A maximum number of seconds to wait before declaring the background /authorize call as failed for timeout
   * Defaults to 60s.
   */
  timeoutInSeconds?: number;

  /**
   * If true, the full response from the /oauth/token endpoint (or the cache, if the cache was used) is returned
   * (minus `refresh_token` if one was issued). Otherwise, just the access token is returned.
   *
   * The default is `false`.
   */
  detailedResponse?: boolean;
}

export type GetTokenSilentlyVerboseResponse = Omit<
  TokenEndpointResponse,
  "refresh_token"
>;

export type TokenEndpointResponse = {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

export type FaableAuthClientConfig = {
  domain: string;
  scope?: string;
  audience?: string;
  redirect_uri?: string;
  clientId: string;
  authorizationParams?: AuthorizationParams;
  cookieDomain?: string;
  useRefreshTokens?: boolean;
  /* If set to 'pkce' PKCE flow. Defaults to the 'implicit' flow otherwise */
  flowType?: AuthFlowType;
  storage?: SupportedStorage;
  /* Optional key name used for storing tokens in local storage. */
  storageKey?: string;

  /**
   * Provide your own locking mechanism based on the environment. By default no locking is done at this time.
   *
   * @experimental
   */
  lock?: LockFunc;
} & BaseLogOptions;

type AnyFunction = (...args: any[]) => any;
type MaybePromisify<T> = T | Promise<T>;
type PromisifyMethods<T> = {
  [K in keyof T]: T[K] extends AnyFunction
    ? (...args: Parameters<T[K]>) => MaybePromisify<ReturnType<T[K]>>
    : T[K];
};

export type SupportedStorage = PromisifyMethods<
  Pick<Storage, "getItem" | "setItem" | "removeItem">
> & {
  /**
   * If set to `true` signals to the library that the storage medium is used
   * on a server and the values may not be authentic, such as reading from
   * request cookies. Implementations should not set this to true if the client
   * is used on a server that reads storage information from authenticated
   * sources, such as a secure database or file.
   */
  isServer?: boolean;
};

export type Provider = "google" | "github";

export type AuthFlowType = "implicit" | "pkce";

export type SignInWithOAuthConnection = {
  /** Default connection is used if not setted. */
  connection?: string;
  /** A URL to send the user to after they are confirmed. */
  redirectTo?: string;
  /** A space-separated list of scopes granted to the OAuth application. */
  scopes?: string;
  /** An object of query params */
  queryParams?: { [key: string]: string };
  /** If set to true does not immediately redirect the current browser context to visit the OAuth authorization page for the provider. */
  skipBrowserRedirect?: boolean;
};

export type OAuthResponse =
  | {
      data: {
        url: string;
      };
      error: null;
    }
  | {
      data: {
        url: null;
      };
      error: AuthError;
    };

export interface Session {
  /**
   * The oauth provider token. If present, this can be used to make external API requests to the oauth provider used.
   */
  provider_token?: string | null;
  /**
   * The oauth provider refresh token. If present, this can be used to refresh the provider_token via the oauth provider's API.
   * Not all oauth providers return a provider refresh token. If the provider_refresh_token is missing, please refer to the oauth provider's documentation for information on how to obtain the provider refresh token.
   */
  provider_refresh_token?: string | null;
  /**
   * The access token jwt. It is recommended to set the JWT_EXPIRY to a shorter expiry value.
   */
  access_token: string;
  /**
   * A one-time used refresh token that never expires.
   */
  refresh_token: string;
  /**
   * The number of seconds until the token expires (since it was issued). Returned when a login is confirmed.
   */
  expires_in: number;
  /**
   * A timestamp of when the token will expire. Returned when a login is confirmed.
   */
  expires_at?: number;
  token_type: string;
  user: User;
}

export type AuthResponse =
  | {
      data: {
        user: User | null;
        session: Session | null;
      };
      error: null;
    }
  | {
      data: {
        user: null;
        session: null;
      };
      error: AuthError;
    };

export type AuthChangeEventMFA = "MFA_CHALLENGE_VERIFIED";

export type AuthChangeEvent =
  | "INITIAL_SESSION"
  | "PASSWORD_RECOVERY"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | AuthChangeEventMFA;

export interface Subscription {
  /**
   * The subscriber UUID. This will be set by the client.
   */
  id: string;
  /**
   * The function to call every time there is an event. eg: (eventName) => {}
   */
  callback: (event: AuthChangeEvent, session: Session | null) => void;
  /**
   * Call this to remove the listener.
   */
  unsubscribe: () => void;
}

export type SignOut = {
  /**
   * Determines which sessions should be
   * logged out. Global means all
   * sessions by this account. Local
   * means only this session. Others
   * means all other sessions except the
   * current one. When using others,
   * there is no sign-out event fired on
   * the current session!
   */
  scope?: "global" | "local" | "others";
};

export type InitializeResult = { error: AuthError | null };

export type UserResponse =
  | {
      data: {
        user: User;
      };
      error: null;
    }
  | {
      data: {
        user: null;
      };
      error: AuthError;
    };

export type CallRefreshTokenResult =
  | {
      session: Session;
      error: null;
    }
  | {
      session: null;
      error: AuthError;
    };
