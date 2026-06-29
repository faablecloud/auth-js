import { BaseLogOptions } from '../BaseLog'
import { LockFunc } from '../lock/locks'
import { AuthError } from './errors'

/**
 * @ignore
 */
export interface AuthenticationResult {
  state: string
  code?: string
  error?: string
  error_description?: string
}

/**
 * OpenID Connect–style user profile returned by the tenant's userinfo
 * endpoint.
 *
 * Standard OIDC claims are typed explicitly; provider-specific or custom
 * claims (e.g. `org_id`, `roles`) surface through the index signature.
 *
 * @see {@link https://faable.com/docs/auth/oidc/userinfo | UserInfo}
 */
export class User {
  name?: string
  profile?: string
  picture?: string
  email?: string
  website?: string
  birthdate?: string
  locale?: string
  sub?: string;
  [key: string]: any
}

/**
 * The state of the application before the user was redirected to the login page.
 */
export type AppState = {
  returnTo?: string
  [key: string]: any
}

export interface AuthorizationParams {
  /**
   * - `'page'`: displays the UI with a full page view
   * - `'popup'`: displays the UI with a popup window
   * - `'touch'`: displays the UI in a way that leverages a touch interface
   * - `'wap'`: displays the UI with a "feature phone" type interface
   */
  display?: 'page' | 'popup' | 'touch' | 'wap'

  /**
   * - `'none'`: do not prompt user for login or consent on reauthentication
   * - `'login'`: prompt user for reauthentication
   * - `'consent'`: prompt user for consent before processing request
   * - `'select_account'`: prompt user to select an account
   */
  prompt?: 'none' | 'login' | 'consent' | 'select_account'

  /**
   * Maximum allowable elapsed time (in seconds) since authentication.
   * If the last time the user authenticated is greater than this value,
   * the user must be reauthenticated.
   */
  max_age?: string | number

  /**
   * The space-separated list of language tags, ordered by preference.
   * For example: `'fr-CA fr en'`.
   */
  ui_locales?: string

  /**
   * Previously issued ID Token.
   */
  id_token_hint?: string

  /**
   * Provides a hint to Auth0 as to what flow should be displayed.
   * The default behavior is to show a login page but you can override
   * this by passing 'signup' to show the signup page instead.
   *
   * This only affects the New Universal Login Experience.
   */
  screen_hint?: 'signup' | 'login' | string

  /**
   * The user's email address or other identifier. When your app knows
   * which user is trying to authenticate, you can provide this parameter
   * to pre-fill the email box or select the right session for sign-in.
   *
   * This currently only affects the classic Lock experience.
   */
  login_hint?: string

  acr_values?: string

  /**
   * The default scope to be used on authentication requests.
   *
   * This defaults to `profile email` if not set. If you are setting extra scopes and require
   * `profile` and `email` to be included then you must include them in the provided scope.
   *
   * Note: The `openid` scope is **always applied** regardless of this setting.
   */
  scope?: string

  /**
   * The default audience to be used for requesting API access.
   */
  audience?: string

  /**
   * The name of the connection configured for your application.
   * If null, it will redirect to the Auth0 Login Page and show
   * the Login Widget.
   */
  connection?: string

  /**
   * The Id of an organization to log in to.
   *
   * This will specify an `organization` parameter in your user's login request and will add a step to validate
   * the `org_id` claim in your user's ID Token.
   */
  organization?: string

  /**
   * The Id of an invitation to accept. This is available from the user invitation URL that is given when participating in a user invitation flow.
   */
  invitation?: string

  /**
   * The default URL where Auth0 will redirect your browser to with
   * the authentication result. It must be whitelisted in
   * the "Allowed Callback URLs" field in your Auth0 Application's
   * settings. If not provided here, it should be provided in the other
   * methods that provide authentication.
   */
  redirect_uri?: string

  /**
   * If you need to send custom parameters to the Authorization Server,
   * make sure to use the original parameter name.
   */
  [key: string]: any
}

interface BaseLoginOptions {
  /**
   * URL parameters that will be sent back to the Authorization Server. This can be known parameters
   * defined by Auth0 or custom parameters that you define.
   */
  authorizationParams?: AuthorizationParams
}

export interface RedirectLoginOptions<
  TAppState = any
> extends BaseLoginOptions {
  /**
   * Used to store state before doing the redirect
   */
  appState?: TAppState
}

export interface IdToken {
  __raw: string
  name?: string
  given_name?: string
  family_name?: string
  middle_name?: string
  nickname?: string
  preferred_username?: string
  profile?: string
  picture?: string
  website?: string
  email?: string
  email_verified?: boolean
  gender?: string
  birthdate?: string
  zoneinfo?: string
  locale?: string
  phone_number?: string
  phone_number_verified?: boolean
  address?: string
  updated_at?: string
  iss?: string
  aud?: string
  exp?: number
  nbf?: number
  iat?: number
  jti?: string
  azp?: string
  nonce?: string
  auth_time?: string
  at_hash?: string
  c_hash?: string
  acr?: string
  amr?: string
  sub_jwk?: string
  cnf?: string
  sid?: string
  org_id?: string
  [key: string]: any
}

export interface GetTokenSilentlyOptions {
  /**
   * When `off`, ignores the cache and always sends a
   * request to Auth0.
   * When `cache-only`, only reads from the cache and never sends a request to Auth0.
   * Defaults to `on`, where it both reads from the cache and sends a request to Auth0 as needed.
   */
  cacheMode?: 'on' | 'off' | 'cache-only'

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
    redirect_uri?: string

    /**
     * The scope that was used in the authentication request
     */
    scope?: string

    /**
     * The audience that was used in the authentication request
     */
    audience?: string

    /**
     * If you need to send custom parameters to the Authorization Server,
     * make sure to use the original parameter name.
     */
    [key: string]: any
  }

  /** A maximum number of seconds to wait before declaring the background /authorize call as failed for timeout
   * Defaults to 60s.
   */
  timeoutInSeconds?: number

  /**
   * If true, the full response from the /oauth/token endpoint (or the cache, if the cache was used) is returned
   * (minus `refresh_token` if one was issued). Otherwise, just the access token is returned.
   *
   * The default is `false`.
   */
  detailedResponse?: boolean
}

export type GetTokenSilentlyVerboseResponse = Omit<
  TokenEndpointResponse,
  'refresh_token'
>

export type TokenEndpointResponse = {
  id_token: string
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

/**
 * Attribute overrides for the bundled cookie storage adapter.
 *
 * Defaults: `Path=/`, `SameSite=Lax`, `Secure` on HTTPS, `Max-Age` 30 days.
 * Use this to share the session across subdomains or tighten `SameSite`.
 *
 * @see {@link https://faable.com/docs/auth/quickstart/nextjs | Next.js Quickstart}
 */
export interface CookieOptions {
  /** (Optional) The domain of the cookie. Use a leading dot to share across subdomains, e.g. `.example.com`. */
  domain?: string
  /** (Optional) The path of the cookie. Defaults to `/`. */
  path?: string
  /** (Optional) The same-site attribute of the cookie. Defaults to `'Lax'`. */
  sameSite?: 'Lax' | 'Strict' | 'None'
  /** (Optional) Whether the cookie should only be sent over HTTPS. Defaults to `true` when the current page is HTTPS. */
  secure?: boolean
  /** (Optional) The maximum age of the cookie in seconds. Defaults to 30 days. */
  maxAge?: number
}

/**
 * Configuration accepted by {@link createClient} and the
 * `FaableAuthClient` constructor.
 *
 * `domain` and `clientId` are the only required fields. Everything else has
 * sensible defaults — see the individual properties for the specifics.
 *
 * @see {@link https://faable.com/docs/auth/get-started | Get Started with Faable Auth}
 * @see {@link https://faable.com/docs/auth/clients | Clients}
 */
export type FaableAuthClientConfig = {
  /** **Required.** Your Faable Auth tenant domain. */
  domain: string
  /** **Required.** Application client ID from the dashboard. */
  clientId: string

  // Optional
  /** Space-separated scopes. Defaults to `openid profile email`. */
  scope?: string
  /**
   * Default API audience the access tokens issued for this client should be
   * bound to. Forwarded to `/authorize` and to the `/oauth/token` POST bodies
   * (code exchange, refresh, OTP). `signInWith*` methods accept an `audience`
   * argument to override it per call.
   */
  audience?: string
  /** Default callback URL. Falls back to `window.location.origin`. */
  redirectUri?: string
  authorizationParams?: AuthorizationParams
  cookieDomain?: string
  useRefreshTokens?: boolean
  /** OAuth flow used when initiating sign-in. Defaults to `'pkce'` in browsers and `'implicit'` elsewhere. */
  flowType?: AuthFlowType
  /**
   * Where to keep the session. Pass `'localStorage'` (default) or `'cookie'`
   * for the bundled adapters, or any custom `SupportedStorage` implementation.
   * The cookie adapter ships with sane defaults (`Path=/`, `SameSite=Lax`,
   * auto `Secure` on HTTPS, 30-day `Max-Age`); use `cookieOptions` to override.
   */
  storage?: SupportedStorage | 'cookie' | 'localStorage'
  /** Optional prefix for the storage key. Final key is `${storageKey}-${clientId}`. */
  storageKey?: string

  /**
   * (Optional) Overrides for the cookie storage attributes. Setting this also
   * implicitly switches to the cookie adapter, so passing `storage: 'cookie'`
   * is not required when you only want to tweak attributes.
   */
  cookieOptions?: CookieOptions

  /**
   * Provide your own locking mechanism based on the environment. By default no locking is done at this time.
   *
   * @experimental
   */
  lock?: LockFunc
} & BaseLogOptions

type AnyFunction = (...args: any[]) => any
type MaybePromisify<T> = T | Promise<T>
type PromisifyMethods<T> = {
  [K in keyof T]: T[K] extends AnyFunction
    ? (...args: Parameters<T[K]>) => MaybePromisify<ReturnType<T[K]>>
    : T[K]
}

/**
 * Minimal storage contract the SDK relies on. Compatible with `localStorage`,
 * `sessionStorage`, the bundled cookie adapter, and any custom adapter you
 * provide. Methods may return synchronously or asynchronously.
 *
 * @example
 * ```ts
 * const memoryStorage: SupportedStorage = {
 *   store: new Map<string, string>(),
 *   getItem: k => memoryStorage.store.get(k) ?? null,
 *   setItem: (k, v) => void memoryStorage.store.set(k, v),
 *   removeItem: k => void memoryStorage.store.delete(k)
 * }
 * ```
 */
export type SupportedStorage = PromisifyMethods<
  Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
> & {
  /**
   * Set to `true` when the storage medium reads from an untrusted source
   * (e.g. request cookies on the server). Triggers a warning when consumers
   * access `session.user` so they refresh against a verified source instead.
   */
  isServer?: boolean
}

/**
 * Built-in social OAuth providers. Custom enterprise / SAML / OIDC
 * connections are addressed by their `connection` name or `connection_id`.
 *
 * @see {@link https://faable.com/docs/auth/connections | Connections}
 */
export type Provider = 'google' | 'github'

/**
 * OAuth initiation flow.
 *
 * - `'pkce'` — recommended for SPAs / public clients; the SDK stores a code
 *   verifier and exchanges the auth code for a session on the callback.
 * - `'implicit'` — tokens are returned directly in the URL fragment.
 *
 * @see {@link https://faable.com/docs/auth/oauth-flows/authorization-code | Authorization Code with PKCE}
 */
export type AuthFlowType = 'implicit' | 'pkce'

/**
 * Options accepted by {@link FaableAuthClient.signInWithOauthConnection}.
 *
 * @see {@link https://faable.com/docs/auth/connections | Connections}
 */
export type SignInWithOAuthConnection = {
  /**
   * Identifier of the connection to use. Preferred over `connection` when
   * known, as the backend resolves it without additional lookups. If both
   * are provided, `connection_id` wins.
   */
  connection_id?: string
  /** Default connection is used if not setted. Kept for compatibility with tenants using connection names. */
  connection?: string
  /** A URL to send the user to after they are confirmed. */
  redirectTo?: string
  /**
   * App-side destination to return the user to once the callback has been
   * processed. It is stored locally alongside the PKCE verifier (never sent
   * to the server) and surfaced back as `returnTo` on the result of
   * {@link FaableAuthClient.handleRedirectCallback} / {@link FaableAuthClient.initialize}.
   */
  returnTo?: string
  /** A space-separated list of scopes granted to the OAuth application. */
  scopes?: string
  /** An object of query params */
  queryParams?: { [key: string]: string }
  /** If set to true does not immediately redirect the current browser context to visit the OAuth authorization page for the provider. */
  skipBrowserRedirect?: boolean
  /**
   * Override the API audience the issued access token should be bound to.
   * Falls back to `FaableAuthClientConfig.audience` when omitted.
   */
  audience?: string
}

/**
 * Result of {@link FaableAuthClient.signInWithOauthConnection}. Carries the
 * authorize URL on success (useful when `skipBrowserRedirect: true` so you
 * can drive the navigation yourself) or an {@link AuthError} on failure.
 */
export type OAuthResponse =
  | {
      data: {
        url: string
      }
      error: null
    }
  | {
      data: {
        url: null
      }
      error: AuthError
    }

/**
 * A signed-in session as persisted by the client.
 *
 * Use {@link FaableAuthClient.getSession} to obtain the current value; the
 * SDK refreshes it automatically before `expires_at`.
 *
 * @see {@link https://faable.com/docs/auth/oidc/userinfo | UserInfo}
 */
export interface Session {
  /**
   * The oauth provider token. If present, this can be used to make external API requests to the oauth provider used.
   */
  provider_token?: string | null
  /**
   * The oauth provider refresh token. If present, this can be used to refresh the provider_token via the oauth provider's API.
   * Not all oauth providers return a provider refresh token. If the provider_refresh_token is missing, please refer to the oauth provider's documentation for information on how to obtain the provider refresh token.
   */
  provider_refresh_token?: string | null
  /**
   * The access token jwt. It is recommended to set the JWT_EXPIRY to a shorter expiry value.
   */
  access_token: string
  /**
   * A one-time used refresh token that never expires.
   */
  refresh_token: string
  /**
   * The number of seconds until the token expires (since it was issued). Returned when a login is confirmed.
   */
  expires_in: number
  /**
   * A timestamp of when the token will expire. Returned when a login is confirmed.
   */
  expires_at?: number
  token_type: string
  user: User
}

/**
 * Discriminated union returned by every sign-in / set-session / refresh
 * method. Always check `error` first — `data` fields are `null` on failure.
 */
export type AuthResponse =
  | {
      data: {
        user: User | null
        session: Session | null
      }
      error: null
    }
  | {
      data: {
        user: null
        session: null
      }
      error: AuthError
    }

export type AuthChangeEventMFA = 'MFA_CHALLENGE_VERIFIED'

/**
 * Event names delivered to {@link FaableAuthClient.onAuthStateChange}
 * callbacks.
 *
 * - `INITIAL_SESSION` — fired once on subscribe with the currently-loaded session
 * - `SIGNED_IN` — a session was newly stored or adopted
 * - `SIGNED_OUT` — the session was cleared (locally or via global sign-out)
 * - `TOKEN_REFRESHED` — the SDK refreshed the access token in the background
 * - `PASSWORD_RECOVERY` — the user landed back from a password-reset link
 * - `USER_UPDATED` — the user object was reloaded from `/me`
 *
 * @see {@link https://faable.com/docs/auth/get-started | Get Started with Faable Auth}
 */
export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'PASSWORD_RECOVERY'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | AuthChangeEventMFA

/**
 * Handle returned by {@link FaableAuthClient.onAuthStateChange}.
 *
 * Call `unsubscribe()` to stop receiving events — for example, in a React
 * `useEffect` cleanup.
 */
export interface Subscription {
  /** Subscriber UUID assigned by the client. */
  id: string
  /** Invoked every time an auth event happens. */
  callback: (event: AuthChangeEvent, session: Session | null) => void
  /** Call to remove the listener. */
  unsubscribe: () => void
}

/**
 * Options accepted by {@link FaableAuthClient.signOut}.
 *
 * @see {@link https://faable.com/docs/auth/oidc/logout | Logout}
 */
export type SignOut = {
  /**
   * Which sessions to log out.
   *
   * - `'global'` — every refresh token for the user (default)
   * - `'local'` — only this client's storage
   * - `'others'` — every other session except this device's; no
   *   `SIGNED_OUT` event is fired locally
   */
  scope?: 'global' | 'local' | 'others'
}

export type InitializeResult = {
  error: AuthError | null
  /**
   * Set when a sign-in redirect was consumed from the URL (e.g.
   * `'PASSWORD_RECOVERY'`). Absent when the session was recovered from
   * storage or there was nothing to process.
   */
  redirectType?: string | null
  /**
   * The app-side destination passed as `returnTo` when starting the sign-in,
   * round-tripped through the flow so the callback page can navigate there.
   */
  returnTo?: string | null
}

export type UserResponse =
  | {
      data: {
        user: User
      }
      error: null
    }
  | {
      data: {
        user: null
      }
      error: AuthError
    }

export type CallRefreshTokenResult =
  | {
      session: Session
      error: null
    }
  | {
      session: null
      error: AuthError
    }
