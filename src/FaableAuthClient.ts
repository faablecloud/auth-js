import { Base } from './Base'
import FaableAuthApi from './FaableAuthApi'
import { buildAndSubmitForm, resolveResponseType } from './lib/auth_helpers'
import { BroadcastSync } from './lib/broadcast_sync'
import { EXPIRY_MARGIN, STORAGE_KEY } from './lib/constants'
import {
  AuthApiError,
  AuthError,
  AuthImplicitGrantRedirectError,
  AuthInvalidTokenResponseError,
  AuthPKCEGrantCodeExchangeError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
  isAuthApiError,
  isAuthError,
  isAuthRetryableFetchError
} from './lib/errors'
import { _get, _post } from './lib/fetch'
import { document, window } from './lib/globals'
import {
  Deferred,
  RawAuthResponse,
  _sessionResponse,
  checkExpiresInTime,
  getCodeChallengeAndMethod,
  isBrowser,
  retryable,
  sleep
} from './lib/helpers'
import { windowHelpers } from './lib/helpers/window'
import { decodeJWTPayload, expiryFromAccessToken } from './lib/jwt'
import {
  LastUsedLoginMethod,
  LastUsedLoginMethodKind,
  consumeLoginAttempt,
  loadLastUsedMethod,
  saveLastUsedMethod,
  saveLoginAttempt
} from './lib/last_used_storage'
import { getSessionFromCookies } from './lib/nextjs'
import { loadCodeVerifier } from './lib/pkce_storage'
import { isValidSession } from './lib/session_helpers'
import { cookieStorageAdapter } from './lib/storage/cookie-storage'
import { localStorageAdapter } from './lib/storage/local-storage'
import { getItemAsync, setItemAsync } from './lib/storage_helpers'
import {
  AuthFlowType,
  AuthResult,
  CallRefreshTokenResult,
  InitializeResult,
  LastUsedCookieOptions,
  OAuthResponse,
  SignInWithOAuthConnection,
  Subscription,
  SupportedStorage,
  User
} from './lib/types'
import {
  AuthChangeEvent,
  AuthResponse,
  FaableAuthClientConfig
} from './lib/types'
import { Session, SignOut } from './lib/types'
import { clearURLParameters, parseParametersFromURL } from './lib/url_helpers'
import { withTimeout } from './lib/with_timeout'
import { Lock } from './lock/Lock'
import { LockAcquireTimeoutError } from './lock/locks'
import { getDomain, getTokenIssuer } from './utils'

export { cookieStorageAdapter, getSessionFromCookies }

/** Current session will be checked for refresh at this interval. */
const AUTO_REFRESH_TICK_DURATION = 30 * 1000

/**
 * A token refresh will be attempted this many ticks before the current session expires. */
const AUTO_REFRESH_TICK_THRESHOLD = 3

/** Hard upper bound for a single refresh-token call before it's aborted. */
const REFRESH_TIMEOUT_MS = 30 * 1000

/**
 * Storage-key suffix for the consume-once sign-out reason
 * ({@link FaableAuthClient.getSignOutReason}). Shares the session's
 * `storageKey` prefix so multiple clients on one origin don't cross-read.
 */
const SIGNOUT_REASON_SUFFIX = '-signout-reason'

/** Consume-once record of why the SDK terminated the session on its own. */
export type SignOutReason = {
  /** Stable machine code when the server sent one (e.g. `user_suspended`). */
  code?: string
  /** Human-readable message from the terminal error. */
  message: string
  /** Epoch ms when the session was terminated. */
  at: number
}

const resolveStorage = (config: FaableAuthClientConfig): SupportedStorage => {
  const { storage, cookieOptions } = config
  if (storage === 'cookie' || cookieOptions) {
    return cookieStorageAdapter(cookieOptions)
  }
  if (storage === 'localStorage' || storage === undefined) {
    return localStorageAdapter
  }
  return storage
}

/**
 * The main entry point of the SDK: an isomorphic client bound to a Faable
 * Auth tenant that drives every authentication flow.
 *
 * Prefer creating it through the {@link createClient} factory in app code.
 * Once instantiated it begins loading its session in the background, so you
 * can subscribe to {@link FaableAuthClient.onAuthStateChange | auth-state
 * changes} and trigger sign-ins right away. The most common starting points
 * are the {@link FaableAuthClient.signInWithOauthConnection | sign-in}
 * methods and {@link FaableAuthClient.getSession | getSession}.
 *
 * @category Getting started
 * @see {@link https://faable.com/docs/auth/get-started | Get Started with Faable Auth}
 */
export class FaableAuthClient extends Base {
  domainUrl: string
  tokenIssuer: string
  redirectUri: string
  scope?: string
  audience?: string
  sessionCheckExpiryDays: number

  protected initializePromise: Promise<InitializeResult> | null = null
  protected _lastInitializeResult: InitializeResult | null = null
  protected detectSessionInUrl = true

  /**
   * Error the auth server returned via redirect (`?error=...&
   * error_description=...`, RFC 6749 §4.1.2.1) on the page we initialized
   * on. Held for one {@link getRedirectError} read: the promise returned by
   * `signInWithOauthConnection` dies with the top-level navigation, so
   * without this stash a server-side deny is invisible to the app
   * (2026-08-21: ten silent "Connect GitHub" retries).
   */
  protected redirectError: {
    error: string
    error_description: string
    error_code?: string
  } | null = null

  protected storageKey: string

  protected clientId: string
  protected storage: SupportedStorage
  protected api: FaableAuthApi

  protected autoRefreshToken: boolean
  protected autoRefreshTicker: ReturnType<typeof setInterval> | null = null
  protected visibilityChangedCallback: (() => Promise<any>) | null = null

  protected refreshingDeferred: Deferred<CallRefreshTokenResult> | null = null

  /**
   * Cross-tab broadcaster + local subscriber registry for state changes.
   */
  protected broadcastSync: BroadcastSync
  protected _session: Session | null = null

  /**
   * Initiation flow to use when redirecting to /authorize. Defaults to
   * PKCE in browsers (recommended for SPAs) and implicit otherwise.
   * Distinct from the callback-side flow which is detected from URL params.
   */
  protected flowType: AuthFlowType

  /** Attribute overrides for the "last used login method" hint cookie. */
  protected lastUsedCookie?: LastUsedCookieOptions

  protected lock: Lock

  /**
   * Creates a new authentication client bound to a Faable Auth tenant.
   *
   * The constructor kicks off {@link FaableAuthClient.initialize} in the
   * background; you do not need to await anything before calling other methods.
   * Prefer the {@link createClient} factory in app code — it has the same
   * effect with less ceremony.
   *
   * @param config Tenant settings. `domain` and `clientId` are required and
   *   throw synchronously when missing.
   * @example
   * ```ts
   * const auth = new FaableAuthClient({
   *   domain: '<faableauth_domain>',
   *   clientId: '<client_id>',
   *   redirectUri: window.location.origin
   * })
   * ```
   * @see {@link https://faable.com/docs/auth/get-started | Get Started with Faable Auth}
   * @see {@link https://faable.com/docs/auth/clients | Clients}
   * @category Getting started
   */
  constructor(config: FaableAuthClientConfig) {
    const debug = config?.debug || false
    super({ debug })

    this.sessionCheckExpiryDays = 1
    this.redirectUri = config?.redirectUri || ''
    if (!config?.domain) {
      throw new Error('Missing domain')
    }
    this.domainUrl = getDomain(config.domain)

    this.tokenIssuer = getTokenIssuer('', this.domainUrl)
    if (!config.clientId) {
      throw new Error('Missing clientId')
    }
    this.clientId = config.clientId
    this.audience = config.audience

    this.api = new FaableAuthApi(this.domainUrl, { debug })

    // Storage key
    const key_prefix = config?.storageKey || STORAGE_KEY
    this.storageKey = `${key_prefix}-${this.clientId}`

    this.storage = resolveStorage(config)

    this.lock = new Lock({
      lock: config.lock,
      storageKey: this.storageKey,
      debug: config.debug
    })

    this.broadcastSync = new BroadcastSync(
      isBrowser() ? this.storageKey : '',
      (msg, ...args) => this._debug(msg, ...args)
    )

    this.flowType = config.flowType ?? (isBrowser() ? 'pkce' : 'implicit')

    this.lastUsedCookie = config.lastUsedCookie

    this.autoRefreshToken = true

    this.initialize()
  }

  /**
   * Cached session value last persisted by the client.
   *
   * This is a synchronous accessor that returns whatever the client has
   * already loaded into memory. It can lag behind storage (for example,
   * across tabs before the broadcast event arrives) and never triggers a
   * refresh. Prefer {@link FaableAuthClient.getSession} when you need an
   * authoritative value, especially on the server.
   *
   * @returns The cached {@link Session} or `null` if no user is signed in.
   * @see {@link https://faable.com/docs/auth/oidc/userinfo | UserInfo}
   * @category Sessions
   */
  get session() {
    return this._session
  }

  /**
   * Initializes the client session either from the URL or from storage.
   *
   * Automatically called once from the constructor and idempotent — extra
   * calls return the same in-flight promise. Call it explicitly when you
   * need to await an OAuth, magic link, or password-recovery redirect to
   * finish processing so you can surface any returned error.
   *
   * @returns A promise that resolves to `{ error }` — non-null when the URL
   *   carried a failure or storage was corrupt; never throws.
   * @example
   * ```ts
   * const { error } = await auth.initialize()
   * if (error) console.error('Auth redirect failed', error)
   * ```
   * @see {@link https://faable.com/docs/auth/oauth-flows/authorization-code | Authorization Code with PKCE}
   * @category Lifecycle
   */
  async initialize(): Promise<InitializeResult> {
    if (this.initializePromise) {
      return await this.initializePromise
    }

    this.initializePromise = (async () => {
      return await this.lock._acquireLock(-1, async () => {
        return await this._initialize()
      })
    })()

    const result = await this.initializePromise
    this._lastInitializeResult = result
    return result
  }

  /**
   * The result of the most recent {@link FaableAuthClient.initialize} run, or
   * `null` while the first one is still in flight.
   *
   * The constructor starts `initialize()` in the background and discards the
   * promise; this accessor lets code that cannot await it (for example a
   * React provider effect) read whether the last OAuth/redirect attempt
   * errored, instead of being stuck with a session that silently stays
   * `null`.
   *
   * @category Lifecycle
   */
  get lastInitializeResult(): InitializeResult | null {
    return this._lastInitializeResult
  }

  /**
   * Completes an OAuth / magic-link / password-recovery redirect on your
   * callback route and reports the outcome.
   *
   * The SDK already consumes the URL during the `initialize()` it kicks off
   * from the constructor; this is a thin, discoverable wrapper that awaits
   * that same in-flight run (idempotent) so you can:
   *
   * - redirect **only once** the token exchange has finished, and
   * - surface `error` instead of hanging on a "Signing you in…" screen when
   *   the exchange fails (e.g. an expired PKCE verifier).
   *
   * It also returns `returnTo` — the app-side destination you optionally
   * passed to `signInWith*({ returnTo })` — so you don't need a side channel
   * (like `sessionStorage`) to remember where to send the user.
   *
   * @example
   * ```ts
   * // app/callback/page.tsx
   * const { error, returnTo } = await auth.handleRedirectCallback()
   * if (error) showError(error.message)
   * else router.replace(returnTo ?? '/')
   * ```
   * @see {@link FaableAuthClient.initialize}
   * @category Lifecycle
   */
  async handleRedirectCallback(): Promise<InitializeResult> {
    return await this.initialize()
  }

  /**
   * IMPORTANT:
   * 1. Never throw in this method, as it is called from the constructor
   * 2. Never return a session from this method as it would be cached over
   *    the whole lifetime of the client
   */
  private async _initialize(): Promise<InitializeResult> {
    try {
      const flow = await this._detectFlowType()

      this._debug('#_initialize()', 'begin', 'flow_type', flow)

      // if exists any flow, process the session
      if (flow) {
        const { data, error } = await this._getSessionFromURL(flow)
        if (error) {
          this._debug(
            '#_initialize()',
            'error detecting session from URL',
            error
          )

          // hacky workaround to keep the existing session if there's an error returned from identity linking
          // TODO: once error codes are ready, we should match against it instead of the message
          if (
            error?.message === 'Identity is already linked' ||
            error?.message === 'Identity is already linked to another user'
          ) {
            return { error }
          }

          // A server-returned error redirect (`?error=...`) is a failed
          // ATTEMPT, not a corrupted session. The user may be signed in and
          // merely failed a connect/link round-trip (2026-08-21: a GitHub
          // connect denied by the network gate); nuking their session here
          // turned a failed connect into a logout. `details` is only set on
          // the error-params throw — the missing-token variants keep the
          // legacy removal below.
          //
          // Matched by `name`, NOT by instanceof: the published CJS bundle is
          // ES5, where subclassing Error breaks the prototype chain — at
          // runtime `constructor.name` is 'Error' and instanceof is false
          // even for an error this very bundle constructed (v2.3.0 shipped
          // the instanceof form and kept logging users out). Same reason the
          // identity-linked workaround above matches on `message`.
          if (
            error?.name === 'AuthImplicitGrantRedirectError' &&
            (error as AuthImplicitGrantRedirectError).details
          ) {
            // This early return skips the storage recovery at the bottom of
            // the flow — load the persisted session into memory here so the
            // signed-in user still LOOKS signed in for this page load.
            await this._recoverAndRefresh()
            return { error }
          }

          // The URL no longer carries any auth-flow artifacts: whatever we
          // just failed to process was already consumed — typically by a
          // second client instance on the same page that stripped the params
          // between our flow detection and the parse (both straddle an
          // await). That is a stale read, not a failed login; removing the
          // session here logged the user out for a URL that no longer says
          // anything. Recover storage like a normal page load instead.
          if ((await this._detectFlowType()) === null) {
            await this._recoverAndRefresh()
            return { error }
          }

          // failed login attempt via url,
          // remove old session as in verifyOtp, signUp and signInWith*
          await this._removeSession()

          return { error }
        }

        const { session, redirectType, returnTo, is_new_user } = data

        this._debug(
          '#_initialize()',
          'detected session in URL',
          session,
          'redirect type',
          redirectType
        )

        await this._saveSession(session)

        setTimeout(async () => {
          if (redirectType === 'recovery') {
            await this._notifyAllSubscribers('PASSWORD_RECOVERY', session)
          } else {
            await this._notifyAllSubscribers('SIGNED_IN', session)
          }
        }, 0)

        return { error: null, redirectType, returnTo, is_new_user }
      }
      // no login attempt via callback url try to recover session from storage
      await this._recoverAndRefresh()
      return { error: null }
    } catch (error) {
      if (isAuthError(error)) {
        return { error }
      }

      return {
        error: new AuthUnknownError(
          'Unexpected error during initialization',
          error
        )
      }
    } finally {
      await this._handleVisibilityChange()
      this._debug('#_initialize()', 'end')
    }
  }

  /**
   * Gets the session data from a URL string
   */
  private async _getSessionFromURL(flow: AuthFlowType): Promise<
    | {
        data: {
          session: Session
          redirectType: string | null
          returnTo: string | null
          is_new_user: boolean
        }
        error: null
      }
    | {
        data: {
          session: null
          redirectType: null
          returnTo: null
          is_new_user: false
        }
        error: AuthError
      }
  > {
    try {
      const params = parseParametersFromURL(window?.location.href)
      // The auth server appends `?signup=true` to the callback when the login
      // just created a new account (social/OAuth only). Surface it so the app
      // can branch into onboarding; strip it from the URL alongside the tokens.
      const is_new_user = params.signup === 'true'
      if (flow == 'pkce') {
        if (!params.code) {
          throw new AuthPKCEGrantCodeExchangeError('No code detected.')
        }

        const { data, error } = await this._exchangeCodeForSession(params.code)
        if (error) throw error

        // Remove code (and the signup marker) from URL
        clearURLParameters(['code', 'signup'])

        await this._promoteLoginAttempt()

        return {
          data: {
            session: data.session,
            redirectType: data.redirectType,
            returnTo: data.returnTo,
            is_new_user
          },
          error: null
        }
      }

      if (params.error || params.error_description || params.error_code) {
        // Server-returned error redirect (RFC 6749 §4.1.2.1): stash it for a
        // one-shot getRedirectError() read and strip the params so a reload
        // doesn't replay the failure. The throw below surfaces it to
        // _initialize, which deliberately KEEPS any existing session — this
        // redirect may come from a connect/link attempt by a signed-in user.
        this.redirectError = {
          error: params.error || 'unspecified_error',
          error_description:
            params.error_description ||
            'Error in URL with unspecified error_description',
          error_code: params.error_code
        }
        clearURLParameters(['error', 'error_description', 'error_code'])
        throw new AuthImplicitGrantRedirectError(
          params.error_description ||
            'Error in URL with unspecified error_description',
          {
            error: params.error || 'unspecified_error',
            code: params.error_code || 'unspecified_code'
          }
        )
      }

      const {
        provider_token,
        provider_refresh_token,
        access_token,
        refresh_token,
        expires_in,
        expires_at,
        token_type
      } = params

      // We only strictly need the token pair. Some flows hand the tokens back
      // in the query string without the full OIDC envelope (`expires_in` /
      // `token_type`); fall back to the access token's own `exp` claim and a
      // `bearer` default instead of rejecting an otherwise-valid callback.
      if (!access_token || !refresh_token) {
        throw new AuthImplicitGrantRedirectError('No session defined in URL')
      }

      let expiresAt: number
      let expiresIn: number
      if (expires_in) {
        // Check time is valid
        ;({ expiresAt, expiresIn } = checkExpiresInTime({
          expires_in,
          expires_at,
          refreshTick: AUTO_REFRESH_TICK_DURATION
        }))
      } else {
        ;({ expiresAt, expiresIn } = expiryFromAccessToken(
          access_token,
          expires_at
        ))
      }

      const { data: user, error } = await this._getUser(access_token)

      if (error || !user) throw error

      const session: Session = {
        provider_token,
        provider_refresh_token,
        access_token,
        expires_in: expiresIn,
        expires_at: expiresAt,
        refresh_token,
        token_type: token_type || 'bearer',
        user
      }

      // Remove tokens from URL
      clearURLParameters([
        'access_token',
        'expires_in',
        'refresh_token',
        'token_type',
        'scope',
        'signup'
      ])
      this._debug('#_getSessionFromURL()', 'clearing window.location.hash')

      await this._promoteLoginAttempt()

      return {
        data: {
          session,
          redirectType: params.type,
          returnTo: null,
          is_new_user
        },
        error: null
      }
    } catch (error) {
      this._debug(error)
      if (isAuthError(error)) {
        return {
          data: {
            session: null,
            redirectType: null,
            returnTo: null,
            is_new_user: false
          },
          error
        }
      }
      throw error
    }
  }

  private async _exchangeCodeForSession(authCode: string): Promise<
    | {
        data: {
          session: Session
          user: User
          redirectType: string | null
          returnTo: string | null
        }
        error: null
      }
    | {
        data: {
          session: null
          user: null
          redirectType: null
          returnTo: null
        }
        error: AuthError
      }
  > {
    const stored = await loadCodeVerifier(
      this.storage,
      `${this.storageKey}-code-verifier`
    )
    if (!stored) {
      return {
        data: { user: null, session: null, redirectType: null, returnTo: null },
        error: new AuthPKCEGrantCodeExchangeError(
          'No active PKCE code verifier — the authorization flow has expired or was not started'
        )
      }
    }
    const {
      verifier: codeVerifier,
      redirectType = null,
      returnTo = null
    } = stored

    const rawResponse = await _post<Partial<RawAuthResponse>>(
      `${this.domainUrl}/oauth/token`,
      {
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code: authCode,
        code_verifier: codeVerifier,
        ...(this.audience ? { audience: this.audience } : {})
      }
    )

    const { data, error } = _sessionResponse(rawResponse)

    if (!data) {
      throw new Error('Missing data')
    }

    await this.storage.removeItem(`${this.storageKey}-code-verifier`)

    if (error) {
      return {
        data: { user: null, session: null, redirectType: null, returnTo: null },
        error
      }
    } else if (!data || !data.session || !data.user) {
      return {
        data: { user: null, session: null, redirectType: null, returnTo: null },
        error: new AuthInvalidTokenResponseError()
      }
    }
    let session = data.session as Session
    if (session) {
      const { data: user, error } = await this._getUser(session.access_token)
      if (error || !user) {
        throw error
      }

      session = {
        ...session,
        user
      }
      data.session = session

      await this._saveSession(session)
      await this._notifyAllSubscribers('SIGNED_IN', session)
    }
    return {
      data: {
        ...data,
        redirectType: redirectType ?? null,
        returnTo: returnTo ?? null
      } as any,
      error
    }
  }

  /**
   * Registers callbacks on the browser / platform, which in-turn run
   * algorithms when the browser window/tab are in foreground. On non-browser
   * platforms it assumes always foreground.
   */
  private async _handleVisibilityChange() {
    this._debug('#_handleVisibilityChange()')

    if (!isBrowser() || !window?.addEventListener) {
      if (this.autoRefreshToken) {
        // in non-browser environments the refresh token ticker runs always
        this.startAutoRefresh()
      }

      return false
    }

    try {
      this.visibilityChangedCallback = async () =>
        await this._onVisibilityChanged(false)

      window?.addEventListener(
        'visibilitychange',
        this.visibilityChangedCallback
      )

      // now immediately call the visbility changed callback to setup with the
      // current visbility state
      await this._onVisibilityChanged(true) // initial call
    } catch (error) {
      console.error('_handleVisibilityChange', error)
    }
  }

  /**
   * Callback registered with `window.addEventListener('visibilitychange')`.
   */
  private async _onVisibilityChanged(calledFromInitialize: boolean) {
    const methodName = `#_onVisibilityChanged(${calledFromInitialize})`
    this._debug(methodName, 'visibilityState', document.visibilityState)

    if (document.visibilityState === 'visible') {
      if (this.autoRefreshToken) {
        // in browser environments the refresh token ticker runs only on focused tabs
        // which prevents race conditions
        this._startAutoRefresh()
      }

      if (!calledFromInitialize) {
        // called when the visibility has changed, i.e. the browser
        // transitioned from hidden -> visible so we need to see if the session
        // should be recovered immediately... but to do that we need to acquire
        // the lock first asynchronously
        await this.initializePromise

        await this.lock._acquireLock(-1, async () => {
          if (document.visibilityState !== 'visible') {
            this._debug(
              methodName,
              'acquired the lock to recover the session, but the browser visibilityState is no longer visible, aborting'
            )

            // visibility has changed while waiting for the lock, abort
            return
          }

          // recover the session
          await this._recoverAndRefresh()
        })
      }
    } else if (document.visibilityState === 'hidden') {
      if (this.autoRefreshToken) {
        this._stopAutoRefresh()
      }
    }
  }

  /**
   * Recovers the session from LocalStorage and refreshes
   * Note: this method is async to accommodate for AsyncStorage e.g. in React native.
   */
  private async _recoverAndRefresh() {
    const debugName = '#_recoverAndRefresh()'
    this._debug(debugName, 'begin')

    try {
      const currentSession = await getItemAsync(this.storage, this.storageKey)
      this._debug(debugName, 'session from storage', currentSession)

      if (!isValidSession(currentSession)) {
        this._debug(debugName, 'session is not valid')
        if (currentSession !== null) {
          await this._removeSession()
        }

        return
      }

      const timeNow = Math.round(Date.now() / 1000)
      const expiresWithMargin =
        (currentSession.expires_at ?? Infinity) < timeNow + EXPIRY_MARGIN

      this._debug(
        debugName,
        `session has${
          expiresWithMargin ? '' : ' not'
        } expired with margin of ${EXPIRY_MARGIN}s`
      )

      if (expiresWithMargin) {
        if (this.autoRefreshToken && currentSession.refresh_token) {
          const { error } = await this._callRefreshToken(
            currentSession.refresh_token
          )

          if (error) {
            console.error(error)

            if (!isAuthRetryableFetchError(error)) {
              this._debug(
                debugName,
                'refresh failed with a non-retryable error, removing the session',
                error
              )
              await this._removeSession()
            }
          }
        }
      } else {
        // no need to persist currentSession again, as we just loaded it from
        // local storage; persisting it again may overwrite a value saved by
        // another client with access to the same local storage
        this._session = currentSession
        await this._notifyAllSubscribers('SIGNED_IN', currentSession)
      }
    } catch (err) {
      this._debug(debugName, 'error', err)

      console.error(err)
      return
    } finally {
      this._debug(debugName, 'end')
    }
  }

  /**
   * Removes any registered visibilitychange callback.
   *
   * @see startAutoRefresh
   * @see stopAutoRefresh
   */
  private _removeVisibilityChangedCallback() {
    this._debug('#_removeVisibilityChangedCallback()')

    const callback = this.visibilityChangedCallback
    this.visibilityChangedCallback = null

    try {
      if (callback && isBrowser() && window?.removeEventListener) {
        window.removeEventListener('visibilitychange', callback)
      }
    } catch (e) {
      console.error('removing visibilitychange callback failed', e)
    }
  }

  /**
   * Starts an auto-refresh process in the background. The session is checked
   * every few seconds. Close to the time of expiration a process is started to
   * refresh the session. If refreshing fails it will be retried for as long as
   * necessary.
   *
   * If `autoRefreshToken` is enabled in the client config you don't need to
   * call this function, it will be called for you.
   *
   * On browsers the refresh process works only when the tab/window is in the
   * foreground to conserve resources as well as prevent race conditions and
   * flooding auth with requests. If you call this method any managed
   * visibility change callback will be removed and you must manage visibility
   * changes on your own.
   *
   * On non-browser platforms the refresh process works *continuously* in the
   * background, which may not be desirable. You should hook into your
   * platform's foreground indication mechanism and call these methods
   * appropriately to conserve resources.
   *
   * @example
   * ```ts
   * // React Native / Node: drive the refresh loop on focus events yourself
   * appState.addEventListener('change', state => {
   *   if (state === 'active') auth.startAutoRefresh()
   * })
   * ```
   * @see {@link https://faable.com/docs/auth/oauth-flows/refresh-token | Refresh Token}
   * @category Sessions
   */
  async startAutoRefresh() {
    this._removeVisibilityChangedCallback()
    await this._startAutoRefresh()
  }

  /**
   * This is the private implementation of {@link #startAutoRefresh}. Use this
   * within the library.
   */
  private async _startAutoRefresh() {
    await this._stopAutoRefresh()

    this._debug('#_startAutoRefresh()')

    const ticker = setInterval(
      () => this._autoRefreshTokenTick(),
      AUTO_REFRESH_TICK_DURATION
    )
    this.autoRefreshTicker = ticker

    if (
      ticker &&
      typeof ticker === 'object' &&
      typeof ticker.unref === 'function'
    ) {
      // ticker is a NodeJS Timeout object that has an `unref` method
      // https://nodejs.org/api/timers.html#timeoutunref
      // When auto refresh is used in NodeJS (like for testing) the
      // `setInterval` is preventing the process from being marked as
      // finished and tests run endlessly. This can be prevented by calling
      // `unref()` on the returned object.
      ticker.unref()
    } else if (
      typeof (globalThis as any).Deno !== 'undefined' &&
      typeof (globalThis as any).Deno.unrefTimer === 'function'
    ) {
      // Same intent as Node's unref(), via the Deno API.
      // https://deno.land/api@latest?unstable&s=Deno.unrefTimer
      ;(globalThis as any).Deno.unrefTimer(ticker)
    }

    // run the tick immediately, but in the next pass of the event loop so that
    // #_initialize can be allowed to complete without recursively waiting on
    // itself
    setTimeout(async () => {
      await this.initializePromise
      await this._autoRefreshTokenTick()
    }, 0)
  }

  /**
   * This is the private implementation of {@link #stopAutoRefresh}. Use this
   * within the library.
   */
  private async _stopAutoRefresh() {
    this._debug('#_stopAutoRefresh()')

    const ticker = this.autoRefreshTicker
    this.autoRefreshTicker = null

    if (ticker) {
      clearInterval(ticker)
    }
  }

  /**
   * Runs the auto refresh token tick.
   */
  private async _autoRefreshTokenTick() {
    this._debug('#_autoRefreshTokenTick()', 'begin')

    try {
      await this.lock._acquireLock(0, async () => {
        try {
          const now = Date.now()

          try {
            return await this._useSession(async result => {
              const {
                data: { session }
              } = result

              if (!session || !session.refresh_token || !session.expires_at) {
                this._debug('#_autoRefreshTokenTick()', 'no session')
                return
              }

              // session will expire in this many ticks (or has already expired if <= 0)
              const expiresInTicks = Math.floor(
                (session.expires_at * 1000 - now) / AUTO_REFRESH_TICK_DURATION
              )

              this._debug(
                '#_autoRefreshTokenTick()',
                `access token expires in ${expiresInTicks} ticks, a tick lasts ${AUTO_REFRESH_TICK_DURATION}ms, refresh threshold is ${AUTO_REFRESH_TICK_THRESHOLD} ticks`
              )

              if (expiresInTicks <= AUTO_REFRESH_TICK_THRESHOLD) {
                await this._callRefreshToken(session.refresh_token)
              }
            })
          } catch (e: any) {
            console.error(
              'Auto refresh tick failed with error. This is likely a transient error.',
              e
            )
          }
        } finally {
          this._debug('#_autoRefreshTokenTick()', 'end')
        }
      })
    } catch (e: any) {
      if (e.isAcquireTimeout || e instanceof LockAcquireTimeoutError) {
        this._debug('auto refresh token tick lock not available')
      } else {
        throw e
      }
    }
  }

  private async _detectFlowType(): Promise<AuthFlowType | null> {
    const params = parseParametersFromURL(window?.location.href)

    const browser = isBrowser()

    // PKCE
    if (browser && params.code) {
      return 'pkce'
    }

    // Implicit
    if (browser && (params.access_token || params.error_description)) {
      return 'implicit'
    }
    return null
  }

  private _scope() {
    return this.scope || 'openid profile email'
  }

  private async _getUrlForConnection(
    url: string,
    params: {
      connection?: string
      connection_id?: string
      redirectTo?: string
      returnTo?: string
      scopes?: string
      response_type?: 'code' | 'token'
      queryParams?: { [key: string]: string }
      skipBrowserRedirect?: boolean
      audience?: string
    }
  ) {
    let urlParams: Record<string, any> = params.queryParams || {}

    const authorize_params: Record<string, any> = {
      client_id: this.clientId,
      response_type: params.response_type,
      redirect_uri:
        params.redirectTo || this.redirectUri || window?.location.origin,
      scope: params.scopes || this._scope()
    }

    if (this.flowType === 'pkce') {
      const [codeChallenge, codeChallengeMethod] =
        await getCodeChallengeAndMethod(
          this.storage,
          this.storageKey,
          false,
          params.returnTo
        )

      urlParams = {
        ...urlParams,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod
      }
    }

    if (params.connection_id) {
      authorize_params.connection_id = params.connection_id
    } else if (params.connection) {
      authorize_params.connection = params.connection
    }

    const audience = params.audience ?? this.audience
    if (audience) {
      authorize_params.audience = audience
    }

    return `${url}?${new URLSearchParams({
      ...urlParams,
      ...authorize_params
    })}`
  }

  /**
   * Starts an OAuth / social login by redirecting the browser to the tenant's
   * `/authorize` endpoint for the chosen connection.
   *
   * In browsers the SDK redirects the current window unless
   * `skipBrowserRedirect` is `true`. On that redirect success path the returned
   * promise **never resolves** — the pending navigation owns the page, so a
   * loading state you tie to the `await` stays on until unload instead of
   * flashing back. Pass `skipBrowserRedirect: true` to get `{ data: { url } }`
   * back and drive the navigation yourself. PKCE is used by default in
   * browsers, falling back to the implicit flow elsewhere. Prefer
   * `connection_id` when known — the backend resolves it without an extra
   * lookup; `connection` (by name) is kept for legacy tenants.
   *
   * @example
   * ```ts
   * // Redirects the current window; the promise does not resolve on success.
   * await auth.signInWithOauthConnection({
   *   connection: 'google',
   *   redirectTo: 'https://app.example.com/callback'
   * })
   *
   * // Or take over the navigation yourself:
   * const { data } = await auth.signInWithOauthConnection({
   *   connection: 'google',
   *   skipBrowserRedirect: true
   * })
   * window.location.assign(data.url)
   * ```
   * @see {@link https://faable.com/docs/auth/connections | Connections}
   * @see {@link https://faable.com/docs/auth/oauth-flows/authorization-code | Authorization Code with PKCE}
   * @category Sign in
   */
  async signInWithOauthConnection(
    credentials: SignInWithOAuthConnection
  ): Promise<OAuthResponse> {
    return await this._handleConnectionSignIn({
      connection: credentials.connection,
      connection_id: credentials.connection_id,
      redirectTo: credentials?.redirectTo,
      returnTo: credentials?.returnTo,
      scopes: credentials?.scopes,
      queryParams: credentials.queryParams,
      skipBrowserRedirect: credentials.skipBrowserRedirect,
      audience: credentials.audience
    })
  }

  /**
   * Links an additional OAuth identity (e.g. GitHub) to the CURRENTLY
   * signed-in user — the identity round-trip proves control of the provider
   * account and attaches it to the session user; it never signs in, never
   * creates a user, and never touches the user's email or profile.
   *
   * This is NOT {@link signInWithOauthConnection}: a sign-in with an unknown
   * provider identity creates a brand-new user, which is exactly the
   * duplicate-account hole "connect" buttons used to fall into. Requires an
   * active session (the server returns `error=login_required` otherwise) and
   * must not be combined with `prompt: 'login'` (it would destroy the
   * session being linked to).
   *
   * On failure the server redirects back with `?error=...` — read it with
   * {@link getRedirectError} after the round-trip.
   *
   * @example
   * ```ts
   * await auth.linkOauthConnection({
   *   connection_id: GITHUB_CONNECTION_ID,
   *   redirectTo: window.location.href
   * })
   * ```
   * @see {@link https://faable.com/docs/auth/connections | Connections}
   * @category Sign in
   */
  async linkOauthConnection(
    credentials: SignInWithOAuthConnection
  ): Promise<OAuthResponse> {
    return await this._handleConnectionSignIn({
      connection: credentials.connection,
      connection_id: credentials.connection_id,
      redirectTo: credentials?.redirectTo,
      returnTo: credentials?.returnTo,
      scopes: credentials?.scopes,
      queryParams: credentials.queryParams,
      skipBrowserRedirect: credentials.skipBrowserRedirect,
      audience: credentials.audience,
      link: true
    })
  }

  /**
   * Signs the user in with a username + password against a database
   * connection on the tenant.
   *
   * The server responds with an HTML form that posts the user back to the
   * tenant's `/login/callback` to complete the OAuth flow; the SDK
   * auto-submits it from the current document. That is why the success path
   * resolves to `{ data: null, error: null }` — the actual session lands on
   * the redirect target, not on this return value. Subscribe with
   * {@link FaableAuthClient.onAuthStateChange} to observe the resulting
   * `SIGNED_IN` event.
   *
   * @example
   * ```ts
   * await auth.signInWithUsernamePassword({
   *   username: 'user@example.com',
   *   password: '••••••••',
   *   redirectTo: 'https://app.example.com/callback'
   * })
   * ```
   * @see {@link https://faable.com/docs/auth/connections | Connections}
   * @category Sign in
   */
  async signInWithUsernamePassword(data: {
    username: string
    password: string
    redirectTo?: string
    state?: string
    audience?: string
  }): Promise<AuthResult<null>> {
    const audience = data.audience ?? this.audience
    const rawAuthResponse = await _post<string>(
      `${this.domainUrl}/usernamepassword/login`,
      {
        username: data.username,
        password: data.password,
        redirect_uri:
          data.redirectTo || this.redirectUri || window?.location.origin,
        client_id: this.clientId,
        state: data.state,
        ...(audience ? { audience } : {})
      },
      { raw: true }
    )

    if (!rawAuthResponse.data || rawAuthResponse.error) {
      const raw = rawAuthResponse.error
      const message =
        (raw instanceof Error ? raw.message : raw) ||
        'Error in username password login'
      return {
        data: null,
        // When the server answered, surface a typed error carrying its
        // stable machine code (e.g. `user_suspended`) so login UIs can
        // branch on `error.code`; without a status there was no verdict
        // (network failure) and the legacy unknown-error shape stands.
        error:
          rawAuthResponse.status !== undefined
            ? new AuthApiError(
                message,
                rawAuthResponse.status,
                rawAuthResponse.code
              )
            : new AuthUnknownError(message, raw)
      }
    }
    // The form below navigates the page; record the attempt while we still can.
    await this._saveLoginAttempt({ method: 'password' })
    buildAndSubmitForm(rawAuthResponse.data, document)
    return { data: null, error: null }
  }

  /**
   * Registers a new user against the tenant's database connection with an
   * email + password, then signs them in — so an email/password signup form
   * can live entirely in the browser with no backend of your own.
   *
   * This calls the public `POST /dbconnections/signup` endpoint (the Faable
   * analogue of Auth0's `/dbconnections/signup`) which creates the user and
   * its credential in one step, then chains
   * {@link FaableAuthClient.signInWithUsernamePassword} to establish the
   * session.
   *
   * **Auto-login navigates the browser.** Like every interactive
   * username/password login in this SDK, the sign-in step submits a form that
   * round-trips through the auth server, so on success the page redirects to
   * your `redirectTo` and the live session is delivered there by
   * {@link FaableAuthClient.initialize} (and a `SIGNED_IN` event). This method
   * only returns synchronously when signup itself fails, or in non-navigating
   * runtimes (e.g. tests).
   *
   * The user is created with `email_verified: false`; any verification /
   * welcome email is driven by the tenant's account settings.
   *
   * @param data The new user's email, password and optional profile fields.
   * @example
   * ```ts
   * const { error } = await auth.signUp({
   *   email: 'user@example.com',
   *   password: '••••••••',
   *   name: 'Ada Lovelace',
   *   redirectTo: 'https://app.example.com/callback'
   * })
   * if (error) showError(error.message) // e.g. 'email_taken', 'signup_disabled'
   * // otherwise the browser is already navigating to complete the login
   * ```
   * @see {@link https://faable.com/docs/auth/connections | Connections}
   * @category Sign in
   */
  async signUp(data: {
    email: string
    password: string
    name?: string
    given_name?: string
    family_name?: string
    user_metadata?: Record<string, unknown>
    connection?: string
    redirectTo?: string
    state?: string
    audience?: string
  }): Promise<AuthResult<null>> {
    if (!data?.email || !data?.password) {
      return {
        data: null,
        error: new AuthUnknownError('email and password are required', null)
      }
    }

    const { data: body, error } = await _post(
      `${this.domainUrl}/dbconnections/signup`,
      {
        client_id: this.clientId,
        email: data.email,
        password: data.password,
        ...(data.name ? { name: data.name } : {}),
        ...(data.given_name ? { given_name: data.given_name } : {}),
        ...(data.family_name ? { family_name: data.family_name } : {}),
        ...(data.user_metadata ? { user_metadata: data.user_metadata } : {}),
        ...(data.connection ? { connection: data.connection } : {})
      }
    )

    if (error) {
      // `_post` hands back the server's `{ status, message }` body as `data`
      // and its `message` as `error`. Map the HTTP status to a stable
      // ErrorCode so callers can branch without string-matching the message.
      const status = (body as any)?.status as number | undefined
      const code =
        status === 403
          ? 'signup_disabled'
          : status === 409
            ? 'email_exists'
            : undefined
      return {
        data: null,
        error: new AuthApiError(String(error), status ?? 500, code)
      }
    }

    // Auto-login through the standard redirect flow (no ROPC grant exists for
    // database connections, so this is the same path a manual login takes).
    return this.signInWithUsernamePassword({
      username: data.email,
      password: data.password,
      redirectTo: data.redirectTo,
      state: data.state,
      audience: data.audience
    })
  }

  /**
   * Completes a passwordless login by exchanging an OTP code for a session.
   *
   * Pair this with {@link FaableAuthClient.signInWithPasswordless} called
   * with `type: 'code'`. On success the new session is persisted to storage
   * and a `SIGNED_IN` event is broadcast.
   *
   * @param data The user identifier and the OTP code they received.
   * @example
   * ```ts
   * const { data, error } = await auth.signInWithOtp({
   *   username: 'user@example.com',
   *   otp: '123456'
   * })
   * ```
   * @see {@link https://faable.com/docs/auth/passwordless | Passwordless Authentication}
   * @category Sign in
   */
  async signInWithOtp(data: {
    username: string
    otp: string
    audience?: string
  }): Promise<AuthResponse> {
    const audience = data.audience ?? this.audience
    const rawResponse = await _post<Partial<RawAuthResponse>>(
      `${this.domainUrl}/oauth/token`,
      {
        client_id: this.clientId,
        grant_type: 'http://auth0.com/oauth/grant-type/passwordless/otp',
        username: data.username,
        otp: data.otp,
        ...(audience ? { audience } : {})
      }
    )

    const { data: sessionData, error } = _sessionResponse(rawResponse)

    if (error) {
      return { data: { user: null, session: null }, error }
    }

    if (!sessionData || !sessionData.session) {
      return {
        data: { user: null, session: null },
        error: new AuthInvalidTokenResponseError()
      }
    }

    const session = sessionData.session as Session
    const { data: user, error: userError } = await this._getUser(
      session.access_token
    )

    if (userError || !user) {
      return {
        data: { user: null, session: null },
        error:
          userError || new AuthUnknownError('Could not fetch user info', null)
      }
    }

    session.user = user
    await this._saveSession(session)
    await this._notifyAllSubscribers('SIGNED_IN', session)

    // OTP is the one interactive flow that establishes the session in-page,
    // so the confirmed method is recorded directly (no attempt/promotion).
    this._recordLastUsedMethod({ method: 'otp' })

    return {
      data: { user: session.user, session },
      error: null
    }
  }

  /**
   * Starts a passwordless login flow by emailing the user either an OTP code
   * or a magic link.
   *
   * - `type: 'code'` sends a short code the user pastes into your UI; finish
   *   the flow with {@link FaableAuthClient.signInWithOtp}.
   * - `type: 'link'` sends a clickable link that lands on your `redirectUri`
   *   with the tokens already attached, processed by
   *   {@link FaableAuthClient.initialize} on page load.
   *
   * @param data The user's email and the delivery mechanism.
   * @example
   * ```ts
   * await auth.signInWithPasswordless({
   *   email: 'user@example.com',
   *   type: 'code'
   * })
   * ```
   * @see {@link https://faable.com/docs/auth/passwordless | Passwordless Authentication}
   * @category Sign in
   */
  async signInWithPasswordless(data: {
    email: string
    type: 'code' | 'link'
    audience?: string
  }): Promise<AuthResult<any>> {
    const audience = data.audience ?? this.audience
    const response = await _post(`${this.domainUrl}/passwordless/start`, {
      client_id: this.clientId,
      email: data.email,
      send: data.type,
      ...(audience ? { audience } : {})
    })

    return { data: response.data, error: response.error }
  }

  /**
   * Triggers a "change your password" email for a database-connection user.
   *
   * The current session is unaffected — the user clicks the link in the
   * email and completes the reset on the tenant's hosted pages. The promise
   * resolves once the email has been queued.
   *
   * @param params The user's email address.
   * @example
   * ```ts
   * await auth.changePassword({ email: 'user@example.com' })
   * ```
   * @see {@link https://faable.com/docs/auth/connections | Connections}
   * @category Account
   */
  async changePassword(params: {
    email: string
  }): Promise<AuthResult<unknown>> {
    if (!params?.email) {
      return {
        data: null,
        error: new AuthUnknownError('email is required', null)
      }
    }

    const { data, error } = await _post(
      `${this.domainUrl}/dbconnections/change_password`,
      { email: params.email }
    )
    return {
      data: data ?? null,
      error: error ? new AuthUnknownError(String(error), error) : null
    }
  }

  /**
   * Resolves the signed-in user's id from a session. Prefers the userinfo
   * shape (`user.id`) returned by `/me`, falls back to a `sub` claim on the
   * user object, and finally decodes the access token's `sub` — the id is
   * always present there, so this never reports a live session as missing.
   */
  private _resolveUserId(session: Session): string | undefined {
    const fromUser = (session.user as any)?.id ?? session.user?.sub
    if (fromUser) return fromUser
    try {
      const payload = decodeJWTPayload(session.access_token)
      return payload?.sub
    } catch {
      return undefined
    }
  }

  /**
   * Starts a verified email change for the currently signed-in user.
   *
   * The user must be authenticated — the call is made with the session's
   * access token, and the auth server only lets a user change their own
   * email. It creates a verification ticket and emails the user; the change
   * is applied only after they click the link, which the server handles and
   * then redirects to `redirect_uri`. The current session is unaffected until
   * then.
   *
   * @param params The new email plus optional verification policy.
   *   - `verification_mode`: `'new_only'` verifies just the new address;
   *     `'old_and_new'` also requires confirming from the old one. When
   *     omitted the account's default policy applies.
   *   - `redirect_uri`: where the server sends the user after they verify.
   * @example
   * ```ts
   * const { data, error } = await auth.changeEmail({
   *   new_email: 'new@example.com',
   *   redirect_uri: 'https://app.example.com/account'
   * })
   * // data: { status: 'verification_sent', ticket_id, verification_mode }
   * ```
   * @see {@link https://faable.com/docs/auth/change-email | Change Email}
   * @category Account
   */
  async changeEmail(params: {
    new_email: string
    verification_mode?: 'new_only' | 'old_and_new'
    redirect_uri?: string
  }): Promise<AuthResult<unknown>> {
    if (!params?.new_email) {
      return {
        data: null,
        error: new AuthUnknownError('new_email is required', null)
      }
    }

    const { data: sessionData, error: sessionError } = await this.getSession()
    const session = sessionData?.session
    if (sessionError || !session) {
      return {
        data: null,
        error: sessionError || new AuthSessionMissingError()
      }
    }

    // Resolve the user id defensively. `/me` (userinfo) exposes it as
    // `user.id`, but older/other shapes use the `sub` claim; fall back to the
    // access token's own `sub` so we never mistake a present session for a
    // missing one (that regression shipped `changeEmail` reading only `.sub`).
    const user_id = this._resolveUserId(session)
    if (!user_id) {
      return { data: null, error: new AuthSessionMissingError() }
    }

    const { data, error } = await _post(
      `${this.domainUrl}/user/${user_id}/change-email`,
      {
        new_email: params.new_email,
        ...(params.verification_mode
          ? { verification_mode: params.verification_mode }
          : {}),
        ...(params.redirect_uri ? { redirect_uri: params.redirect_uri } : {})
      },
      { token: session.access_token }
    )
    return {
      data: data ?? null,
      error: error ? new AuthUnknownError(String(error), error) : null
    }
  }

  /**
   * Builds the tenant's `/authorize` URL without redirecting the browser.
   *
   * Useful when you need to render a login link, open the page in a popup,
   * or hand the URL to a different runtime (e.g. a webview). For the
   * everyday "click → redirect" flow use {@link FaableAuthClient.authorize}
   * or {@link FaableAuthClient.signInWithOauthConnection}.
   *
   * The redirect target is resolved with this precedence:
   * `options.redirectTo` → `config.redirectUri` → `window.location.origin`.
   *
   * @returns The fully-qualified authorize URL.
   * @example
   * ```ts
   * const url = auth.buildAuthorizeUrl({
   *   connection: 'google',
   *   redirectTo: 'https://app.example.com/callback'
   * })
   * window.open(url, 'login', 'popup')
   * ```
   * @see {@link https://faable.com/docs/auth/oauth-flows/authorization-code | Authorization Code with PKCE}
   * @category Authorize URLs
   */
  buildAuthorizeUrl(
    options: {
      connection?: string
      redirectTo?: string
      scope?: string
      response_type?: string
      audience?: string
      /**
       * Extra `/authorize` params merged in as-is — e.g.
       * `{ prompt: 'select_account' }` or `{ prompt: 'login' }` to force
       * account selection / re-authentication even when an SSO session exists.
       */
      queryParams?: { [key: string]: string }
    } = {}
  ): string {
    const params: Record<string, string | undefined> = {
      ...options.queryParams,
      client_id: this.clientId,
      redirect_uri:
        options.redirectTo || this.redirectUri || window?.location.origin,
      response_type: resolveResponseType(options, isBrowser()),
      audience: options.audience ?? this.audience,
      scope: options.scope,
      connection: options.connection
    }

    const definedParams = Object.fromEntries(
      Object.entries(params).filter(([, value]) => !!value)
    ) as Record<string, string>

    return `${this.domainUrl}/authorize?${new URLSearchParams(definedParams).toString()}`
  }

  /**
   * Builds the tenant's RP-initiated logout URL
   * (`{domain}/logout?client_id=…`).
   *
   * Navigate the browser to it (top-level, not `fetch`) to end the session and
   * clear the auth server's SSO cookie — the only reliable way to do that from
   * another origin. {@link FaableAuthClient.signOut} does this for you by
   * default; use this helper when you want to drive the navigation yourself.
   *
   * @param options.returnTo Where to send the browser after logout, mapped to
   *   the OIDC `post_logout_redirect_uri`. Must be registered as a logout URL
   *   on the client or the server responds `400`.
   * @example
   * ```ts
   * window.location.assign(auth.getLogoutUrl({ returnTo: 'https://app.example.com' }))
   * ```
   * @see {@link https://faable.com/docs/auth/oidc/logout | Logout}
   * @category Authorize URLs
   */
  getLogoutUrl(options: { returnTo?: string } = {}): string {
    const params: Record<string, string> = { client_id: this.clientId }
    if (options.returnTo) {
      params.post_logout_redirect_uri = options.returnTo
    }
    return `${this.domainUrl}/logout?${new URLSearchParams(params).toString()}`
  }

  /**
   * Redirects the current window to the tenant's `/authorize` endpoint.
   *
   * Fire-and-forget: there is no return value because the browser navigates
   * away. The session lands back on your `redirectUri`, where
   * {@link FaableAuthClient.initialize} consumes it on the next page load.
   *
   * @example
   * ```ts
   * auth.authorize({
   *   response_type: 'code',
   *   redirectTo: 'https://app.example.com/callback'
   * })
   * ```
   * @see {@link https://faable.com/docs/auth/oauth-flows/authorization-code | Authorization Code with PKCE}
   * @category Authorize URLs
   */
  authorize(options: {
    redirectTo?: string
    scope?: string
    response_type: string
    audience?: string
  }) {
    const url = this.buildAuthorizeUrl(options)
    windowHelpers.redirect(url)
  }

  private async _handleConnectionSignIn(options: {
    connection?: string
    connection_id?: string
    redirectTo?: string
    returnTo?: string
    scopes?: string
    queryParams?: { [key: string]: string }
    skipBrowserRedirect?: boolean
    audience?: string
    // Link mode: `/authorize?link=true` attaches the resulting identity to
    // the ACTIVE session user instead of signing in/up. See
    // linkOauthConnection().
    link?: boolean
  }) {
    const url: string = await this._getUrlForConnection(
      `${this.domainUrl}/authorize`,
      {
        response_type: isBrowser() ? 'code' : 'token',
        connection: options.connection,
        connection_id: options.connection_id,
        redirectTo: options.redirectTo,
        returnTo: options.returnTo,
        scopes: options.scopes,
        queryParams: options.link
          ? { ...(options.queryParams ?? {}), link: 'true' }
          : options.queryParams,
        audience: options.audience
      }
    )

    this._debug('#_handleConnectionSignIn()', 'options', options, 'url', url)

    // Must happen before the redirect below: the promise never resolves on
    // the navigation path, so there is no "after". Skipped in link mode: a
    // connect round-trip is not how the user signs in, so it must not flip
    // the "last used login method" hint.
    if (!options.link) {
      await this._saveLoginAttempt({
        method: 'oauth',
        connection: options.connection,
        connection_id: options.connection_id
      })
    }

    // try to open on the browser
    if (isBrowser() && !options.skipBrowserRedirect) {
      window?.location.assign(url)
      // `location.assign()` does not block: the navigation is scheduled but the
      // current tick keeps running. If we resolved here, any loading state a
      // consumer tied to the returned promise would flip back on before the
      // page unloads (a visible flash on the button/spinner). Never resolve on
      // the redirect success path — let the pending navigation own the UI until
      // it unloads. Pass `skipBrowserRedirect: true` to get `{ data: { url } }`
      // back and drive the navigation yourself.
      await new Promise<never>(() => {})
    }

    return { data: { url }, error: null }
  }

  /**
   * Best-effort write of a pending login attempt. A storage failure must
   * never break the sign-in itself, so errors are only logged.
   */
  private async _saveLoginAttempt(attempt: {
    method: LastUsedLoginMethodKind
    connection?: string
    connection_id?: string
  }): Promise<void> {
    try {
      await saveLoginAttempt(this.storage, this.storageKey, attempt)
    } catch (error) {
      this._debug('#_saveLoginAttempt()', 'failed', error)
    }
  }

  /**
   * Promotes the pending login attempt (if any) to the confirmed last-used
   * record. Called from the callback path once a session was established;
   * a login started elsewhere (other tab, other device) leaves no attempt
   * and records nothing.
   */
  private async _promoteLoginAttempt(): Promise<void> {
    try {
      const attempt = await consumeLoginAttempt(this.storage, this.storageKey)
      if (!attempt) return
      this._recordLastUsedMethod(attempt)
    } catch (error) {
      this._debug('#_promoteLoginAttempt()', 'failed', error)
    }
  }

  /** Best-effort write of the confirmed last-used method cookie. */
  private _recordLastUsedMethod(record: {
    method: LastUsedLoginMethodKind
    connection?: string
    connection_id?: string
  }): void {
    try {
      saveLastUsedMethod(
        this.storageKey,
        { ...record, at: Date.now() },
        this.lastUsedCookie
      )
    } catch (error) {
      this._debug('#_recordLastUsedMethod()', 'failed', error)
    }
  }

  /**
   * Returns the login method the user last *completed* on this browser, or
   * `null` when none was recorded — for login UIs that want to show a
   * PostHog-style "Last used" hint next to the matching sign-in button.
   *
   * A method is recorded only when the login actually establishes a session
   * (the OAuth/password redirect round-trip finishing, or an OTP exchange
   * succeeding); a clicked button whose flow was abandoned or failed leaves
   * no trace. The record survives {@link FaableAuthClient.signOut} on
   * purpose and lives in a dedicated cookie, so it can be shared across
   * subdomains via the `lastUsedCookie.domain` client config.
   *
   * @returns The last confirmed method (`oauth` logins carry the
   *   `connection` / `connection_id` they were started with) or `null`.
   * @example
   * ```ts
   * const last = await auth.getLastUsedLoginMethod()
   * if (last?.method === 'oauth') highlight(last.connection_id)
   * ```
   * @see {@link https://faable.com/docs/auth/connections | Connections}
   * @category Sign in
   */
  async getLastUsedLoginMethod(): Promise<LastUsedLoginMethod | null> {
    return loadLastUsedMethod(this.storageKey)
  }

  /**
   * Adopts an externally-provided session into the client.
   *
   * Decodes the access token to find its expiry; refreshes immediately when
   * already expired, otherwise fetches the user info to round-trip the
   * session. Persists the result and broadcasts `SIGNED_IN`. An invalid
   * refresh or access token surfaces as `error` on the returned object.
   *
   * @param currentSession Minimal session shape — an access token and a
   *   refresh token. Other fields are recomputed.
   * @example
   * ```ts
   * // After receiving tokens from a custom server-side handoff
   * await auth.setSession({ access_token, refresh_token })
   * ```
   * @see {@link https://faable.com/docs/auth/oidc/userinfo | UserInfo}
   * @category Sessions
   */
  async setSession(currentSession: {
    access_token: string
    refresh_token: string
  }): Promise<AuthResponse> {
    await this.initializePromise

    return await this.lock._acquireLock(-1, async () => {
      return await this._setSession(currentSession)
    })
  }

  /**
   * Returns the session, refreshing it if necessary.
   *
   * The session returned can be `null` if no user is signed in or the last
   * one has logged out.
   *
   * **IMPORTANT:** This method loads values directly from the storage
   * attached to the client. If that storage is based on request cookies (for
   * example, on the server) the values in it may not be authentic and
   * therefore it's strongly advised against using this method and its
   * results in such circumstances — a warning will be emitted when the
   * storage exposes `isServer: true`. Re-fetch the user with a verified
   * call (or verify the access token yourself) before trusting it.
   *
   * @example
   * ```ts
   * const { data, error } = await auth.getSession()
   * if (data.session) console.log(data.session.user)
   * ```
   * @see {@link https://faable.com/docs/auth/oidc/userinfo | UserInfo}
   * @category Sessions
   */
  async getSession() {
    await this.initializePromise

    const result = await this.lock._acquireLock(-1, async () => {
      return this._useSession(async result => {
        return result
      })
    })

    return result
  }

  /**
   * Error the auth server returned via redirect on the current page load
   * (`?error=access_denied&error_description=...`, RFC 6749 §4.1.2.1), or
   * `null` when the page wasn't reached through a failed auth round-trip.
   *
   * Consume-once: the first read clears it (and the params were already
   * stripped from the URL at initialization), so a later router navigation
   * can't re-show a stale failure. Exists because the promise returned by
   * {@link signInWithOauthConnection} dies with the top-level navigation —
   * this is the only place the app can learn WHY the round-trip failed
   * (e.g. an action deny like "Signups from this network are currently
   * restricted").
   *
   * @example
   * ```ts
   * const redirectError = await auth.getRedirectError()
   * if (redirectError) showAlert(redirectError.error_description)
   * ```
   * @category Sessions
   */
  async getRedirectError(): Promise<{
    error: string
    error_description: string
    error_code?: string
  } | null> {
    await this.initializePromise
    const err = this.redirectError
    this.redirectError = null
    return err
  }

  /**
   * Why the SDK last terminated the session on its own (a refresh rejected
   * by the server — e.g. `code: 'user_suspended'`, a revoked grant), or
   * `null` when the last sign-out was voluntary or there was none.
   *
   * Consume-once, like {@link getRedirectError}: the first read clears it so
   * a later visit to the login page can't re-show a stale banner. Persisted
   * in storage (not memory) because the terminating tab usually navigates
   * away — the login page that renders the reason is a fresh document.
   *
   * @example
   * ```ts
   * const reason = await auth.getSignOutReason()
   * if (reason?.code === 'user_suspended') showSuspendedPanel()
   * ```
   * @category Sessions
   */
  async getSignOutReason(): Promise<SignOutReason | null> {
    try {
      const key = this.storageKey + SIGNOUT_REASON_SUFFIX
      const stored = await getItemAsync(this.storage, key)
      if (!stored || typeof stored !== 'object') return null
      await this.storage.removeItem(key)
      const reason = stored as Partial<SignOutReason>
      if (typeof reason.message !== 'string') return null
      return {
        message: reason.message,
        ...(typeof reason.code === 'string' ? { code: reason.code } : {}),
        at: typeof reason.at === 'number' ? reason.at : 0
      }
    } catch (e) {
      // Storage can be unavailable (SSR, privacy modes) — a missing reason
      // must never break the login page.
      this._debug('#getSignOutReason()', 'error', e)
      return null
    }
  }

  /**
   * Persist the reason for an SDK-initiated session termination. Voluntary
   * {@link signOut} never writes this — only terminal refresh failures do.
   */
  private async _stashSignOutReason(error: AuthError) {
    try {
      const reason: SignOutReason = {
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
        at: Date.now()
      }
      await setItemAsync(
        this.storage,
        this.storageKey + SIGNOUT_REASON_SUFFIX,
        reason
      )
    } catch (e) {
      // Best-effort: losing the reason only costs the login page some
      // context; it must never interfere with the sign-out itself.
      this._debug('#_stashSignOutReason()', 'error', e)
    }
  }

  /**
   * Use instead of {@link #getSession} inside the library. It is
   * semantically usually what you want, as getting a session involves some
   * processing afterwards that requires only one client operating on the
   * session at once across multiple tabs or processes.
   */
  private async _useSession<R>(
    fn: (
      result:
        | {
            data: {
              session: Session
            }
            error: null
          }
        | {
            data: {
              session: null
            }
            error: AuthError
          }
        | {
            data: {
              session: null
            }
            error: null
          }
    ) => Promise<R>
  ): Promise<R> {
    this._debug('#_useSession', 'begin')

    try {
      // the use of __loadSession here is the only correct use of the function!
      const result = await this.__loadSession()

      return await fn(result)
    } finally {
      this._debug('#_useSession', 'end')
    }
  }

  /**
   * NEVER USE DIRECTLY!
   *
   * Always use {@link #_useSession}.
   */
  private async __loadSession(): Promise<
    | {
        data: {
          session: Session
        }
        error: null
      }
    | {
        data: {
          session: null
        }
        error: AuthError
      }
    | {
        data: {
          session: null
        }
        error: null
      }
  > {
    this._debug('#__loadSession()', 'begin')

    if (!this.lock.lockAcquired) {
      this._debug(
        '#__loadSession()',
        'used outside of an acquired lock!',
        new Error().stack
      )
    }

    try {
      let currentSession: Session | null = null

      const maybeSession = await getItemAsync(this.storage, this.storageKey)

      this._debug('#getSession()', 'session from storage', maybeSession)

      if (maybeSession !== null) {
        if (isValidSession(maybeSession)) {
          currentSession = maybeSession
        } else {
          this._debug('#getSession()', 'session from storage is not valid')
          await this._removeSession()
        }
      }

      if (!currentSession) {
        return { data: { session: null }, error: null }
      }

      const hasExpired = currentSession.expires_at
        ? currentSession.expires_at <= Date.now() / 1000
        : false

      this._debug(
        '#__loadSession()',
        `session has${hasExpired ? '' : ' not'} expired`,
        'expires_at',
        currentSession.expires_at
      )

      if (!hasExpired) {
        if (this.storage.isServer) {
          const proxySession: Session = new Proxy(currentSession, {
            get(target: any, prop: string, receiver: any) {
              if (prop === 'user') {
                // only show warning when the user object is being accessed from the server
                console.warn(
                  'Reading `session.user` from a server-side cookie store can be insecure: the value is whatever the cookie contains and has not been verified against Faable Auth. Re-fetch the user with `auth.getUser()` (or verify the access token yourself) before trusting it on the server.'
                )
              }
              return Reflect.get(target, prop, receiver)
            }
          })
          currentSession = proxySession
        }

        return { data: { session: currentSession }, error: null }
      }

      const { session, error } = await this._callRefreshToken(
        currentSession.refresh_token
      )
      if (error) {
        return { data: { session: null }, error }
      }

      return { data: { session }, error: null }
    } finally {
      this._debug('#__loadSession()', 'end')
    }
  }

  private async _removeSession() {
    this._debug('#_removeSession()')
    this._session = null
    await this.storage.removeItem(this.storageKey)
  }

  protected async _setSession(currentSession: {
    access_token: string
    refresh_token: string
  }): Promise<AuthResponse> {
    try {
      if (!currentSession.access_token || !currentSession.refresh_token) {
        throw new AuthSessionMissingError()
      }

      const timeNow = Date.now() / 1000
      let expiresAt = timeNow
      let hasExpired = true
      let session: Session | null = null
      const payload = decodeJWTPayload(currentSession.access_token)
      if (payload.exp) {
        expiresAt = payload.exp
        hasExpired = expiresAt <= timeNow
      }

      if (hasExpired) {
        const { session: refreshedSession, error } =
          await this._callRefreshToken(currentSession.refresh_token)
        if (error) {
          return { data: { user: null, session: null }, error: error }
        }

        if (!refreshedSession) {
          return { data: { user: null, session: null }, error: null }
        }
        session = refreshedSession
      } else {
        const { data: user, error } = await this._getUser(
          currentSession.access_token
        )
        if (error || !user) {
          throw error
        }
        session = {
          access_token: currentSession.access_token,
          refresh_token: currentSession.refresh_token,
          user,
          token_type: 'bearer',
          expires_in: expiresAt - timeNow,
          expires_at: expiresAt
        }
        await this._saveSession(session)
        await this._notifyAllSubscribers('SIGNED_IN', session)
      }

      return { data: { user: session.user, session }, error: null }
    } catch (error) {
      if (isAuthError(error)) {
        return { data: { session: null, user: null }, error }
      }

      throw error
    }
  }

  /**
   * set currentSession and currentUser
   * process to _startAutoRefreshToken if possible
   */
  private async _saveSession(session: Session) {
    this._debug('#_saveSession()', session)
    this._session = session

    await setItemAsync(this.storage, this.storageKey, session)
  }

  private async _getUser(access_token: string) {
    if (!access_token) throw new Error('Cannot fetch user without token')
    this._debug('#_getUser() begin')
    const res = await _get<User>(`${this.domainUrl}/me`, {
      token: access_token
    })
    this._debug('#_getUser() end')
    return {
      data: res.data,
      error: res.error,
      status: res.status,
      code: res.code
    }
  }

  private async _callRefreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new AuthSessionMissingError()
    }

    // refreshing is already in progress
    if (this.refreshingDeferred) {
      return this.refreshingDeferred.promise
    }

    const debugName = `#_callRefreshToken(${refreshToken.substring(0, 5)}...)`

    this._debug(debugName, 'begin')

    try {
      this.refreshingDeferred = new Deferred<CallRefreshTokenResult>()

      const { data, error } = await withTimeout(
        this._refreshAccessToken(refreshToken),
        REFRESH_TIMEOUT_MS,
        'Token refresh timed out'
      )
      if (error) throw error
      if (!data.session) throw new AuthSessionMissingError()

      await this._saveSession(data.session)
      await this._notifyAllSubscribers('TOKEN_REFRESHED', data.session)

      const result = { session: data.session, error: null }

      this.refreshingDeferred.resolve(result)

      return result
    } catch (error) {
      this._debug(debugName, 'error', error)

      if (isAuthError(error)) {
        const result = { session: null, error }

        if (!isAuthRetryableFetchError(error)) {
          // The SDK is about to end the session on its own — leave a
          // consume-once record of WHY, so the login screen the user lands
          // on can say "account suspended" instead of going mute. Written
          // BEFORE the removal: the SIGNED_OUT subscribers may navigate.
          await this._stashSignOutReason(error)
          await this._removeSession()
          await this._notifyAllSubscribers('SIGNED_OUT', null)
        }

        this.refreshingDeferred?.resolve(result)

        return result
      }

      this.refreshingDeferred?.reject(error)
      throw error
    } finally {
      this.refreshingDeferred = null
      this._debug(debugName, 'end')
    }
  }

  /**
   * Generates a new JWT.
   * @param refreshToken A valid refresh token that was returned on login.
   */
  private async _refreshAccessToken(
    refreshToken: string
  ): Promise<AuthResponse> {
    const debugName = `#_refreshAccessToken(${refreshToken.substring(0, 5)}...)`
    this._debug(debugName, 'begin')

    try {
      const startedAt = Date.now()

      // will attempt to refresh the token with exponential backoff

      return await retryable(
        async attempt => {
          if (attempt > 0) {
            await sleep(200 * Math.pow(2, attempt - 1)) // 200, 400, 800, ...
          }

          this._debug(debugName, 'refreshing attempt', attempt)

          // return await _post(`${this.url}/token?grant_type=refresh_token`, {
          //   body: { refresh_token: refreshToken },
          //   headers: this.headers,
          //   xform: _sessionResponse,
          // });
          const rawResponse = await _post<Partial<RawAuthResponse>>(
            `${this.domainUrl}/oauth/token`,
            {
              client_id: this.clientId,
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              ...(this.audience ? { audience: this.audience } : {})
            }
          )
          if (rawResponse.error) {
            // No HTTP status → the request never completed (network down,
            // CORS, aborted); a 5xx → the server broke. Neither is a verdict
            // on the grant, so both are retryable — historically EVERY
            // failure here became a non-retryable AuthUnknownError and one
            // wifi blip during a refresh silently signed the user out. With
            // short-lived access tokens (refresh every ~30 min) that would
            // be constant, so only a definitive 4xx may kill the session.
            if (rawResponse.status === undefined || rawResponse.status >= 500) {
              throw new AuthRetryableFetchError(
                rawResponse.error instanceof Error
                  ? rawResponse.error.message
                  : String(rawResponse.error),
                rawResponse.status ?? 0
              )
            }
            // Definitive server rejection: surface the RFC 6749 body as a
            // typed AuthApiError carrying the stable machine code
            // (`user_suspended`, …) so the sign-out reason can record WHY.
            const { error: api_error } = _sessionResponse(rawResponse)
            throw (
              api_error ??
              new AuthUnknownError(
                `Refresh token request failed: ${rawResponse.error}`,
                rawResponse.error
              )
            )
          }
          const session_res = _sessionResponse(rawResponse)

          if (!session_res.data.session?.access_token) {
            throw new AuthInvalidTokenResponseError()
          }
          const {
            data: user,
            error,
            status: user_status,
            code: user_code
          } = await this._getUser(session_res.data.session?.access_token)

          if (error) {
            // Same classification as the grant above: no status / 5xx is
            // transient (the freshly minted token is fine — retry), a 4xx is
            // a real denial (e.g. the user was suspended between the grant
            // and this read) and carries its machine code.
            if (user_status === undefined || user_status >= 500) {
              throw new AuthRetryableFetchError(
                'Could not fetch user info',
                user_status ?? 0
              )
            }
            throw new AuthApiError(
              error instanceof Error ? error.message : String(error),
              user_status,
              user_code
            )
          }
          if (!user) {
            throw new AuthUnknownError('Refresh response missing user', null)
          }

          const x = {
            data: {
              session: {
                ...session_res.data.session,
                user
              },
              user
            },
            error: null
          }
          // this._debug(x);
          return x
        },
        (attempt, error) => {
          const nextBackOffInterval = 200 * Math.pow(2, attempt)
          return (
            error &&
            isAuthRetryableFetchError(error) &&
            // retryable only if the request can be sent before the backoff overflows the tick duration
            Date.now() + nextBackOffInterval - startedAt <
              AUTO_REFRESH_TICK_DURATION
          )
        }
      )
    } catch (error) {
      this._debug(debugName, 'error', error)

      if (isAuthError(error)) {
        return { data: { session: null, user: null }, error }
      }
      throw error
    } finally {
      this._debug(debugName, 'end')
    }
  }

  private async _notifyAllSubscribers(
    event: AuthChangeEvent,
    session: Session | null,
    broadcast = true
  ) {
    const debugName = `#_notifyAllSubscribers(${event})`
    this._debug(debugName, 'begin', session, `broadcast = ${broadcast}`)
    try {
      await this.broadcastSync.notify(event, session, broadcast)
    } finally {
      this._debug(debugName, 'end')
    }
  }

  /**
   * Signs the user out and clears the session from storage.
   *
   * In a browser context this removes the persisted session and broadcasts a
   * `SIGNED_OUT` event to every tab listening on the same `storageKey`. The
   * access token JWT itself remains valid until its `exp` — keep that
   * expiry short.
   *
   * **By default (global scope, in a browser) this navigates the page to the
   * auth server's `/logout` to also clear the SSO cookie**, then returns to
   * `returnTo` if given. Without that navigation the SSO session survives on
   * the auth domain and the next `/authorize` silently re-logs the previous
   * user — a cross-origin `fetch` cannot clear that cookie. On this path the
   * returned promise does not resolve (the browser is unloading). Pass
   * `{ redirect: false }` to keep the legacy fetch-only behaviour, or use
   * {@link FaableAuthClient.getLogoutUrl} to drive the navigation yourself.
   *
   * Scopes:
   * - `'global'` (default) — invalidate all refresh tokens for the user and,
   *   in a browser, redirect to `/logout` to clear the SSO cookie
   * - `'local'` — only clear this client's storage (no redirect)
   * - `'others'` — invalidate every refresh token except this device's; no
   *   `SIGNED_OUT` event is fired locally (no redirect)
   *
   * @example
   * ```ts
   * await auth.signOut() // global — clears local + auth SSO cookie via redirect
   * await auth.signOut({ returnTo: 'https://app.example.com/bye' }) // + landing
   * await auth.signOut({ redirect: false }) // legacy: local + best-effort fetch
   * await auth.signOut({ scope: 'local' }) // only this device, no redirect
   * ```
   * @see {@link https://faable.com/docs/auth/oidc/logout | Logout}
   * @category Sign out
   */
  async signOut(
    options: SignOut = { scope: 'global' }
  ): Promise<{ error: AuthError | null }> {
    await this.initializePromise

    return await this.lock._acquireLock(-1, async () => {
      return await this._signOut(options)
    })
  }

  protected async _signOut(
    { scope = 'global', redirect, returnTo }: SignOut = { scope: 'global' }
  ): Promise<{ error: AuthError | null }> {
    return await this._useSession(async result => {
      const { data, error: sessionError } = result
      if (sessionError) {
        return { error: sessionError }
      }

      // RP-initiated logout: a top-level navigation to /logout is the only way
      // to clear the auth server's SSO cookie from another origin (a cross-site
      // fetch can neither send nor clear it). Default for the global scope in a
      // browser; opt out with { redirect: false }.
      const shouldRedirect =
        scope === 'global' && redirect !== false && isBrowser()
      if (shouldRedirect) {
        // Tear down local state first — the page unloads on the navigation.
        await this._removeSession()
        await this.storage.removeItem(`${this.storageKey}-code-verifier`)
        await this._notifyAllSubscribers('SIGNED_OUT', null)
        windowHelpers.redirect(this.getLogoutUrl({ returnTo }))
        // The browser is navigating away — never resolve, so a loading state
        // tied to the await doesn't flip back before the page unloads.
        await new Promise<never>(() => {})
      }

      // Non-redirect path (opted out, non-global scope, or non-browser):
      // best-effort cross-origin call to revoke server-side tokens. Send
      // credentials so it can clear the cookie when app + auth share a site.
      // Whatever it returns, the LOCAL teardown below must still run — a
      // CORS-blocked or unreachable /logout must never leave the user
      // visibly signed in.
      let revokeError: AuthError | null = null
      const accessToken = data.session?.access_token
      if (accessToken) {
        const { error } = await this.api.signOut({
          client_id: this.clientId,
          credentials: 'include'
        })
        if (error) {
          // Surface only real API rejections, and even those AFTER the local
          // teardown. Swallowed entirely: network/CORS failures (cross-site
          // /logout is expected to be blocked — the redirect flow is the
          // robust path), 404s (user might not exist anymore) and 401s (an
          // invalid or expired JWT should sign out the current session).
          if (
            isAuthApiError(error) &&
            error.status !== 404 &&
            error.status !== 401
          ) {
            revokeError = error
          }
        }
      }
      if (scope !== 'others') {
        await this._removeSession()
        await this.storage.removeItem(`${this.storageKey}-code-verifier`)
        await this._notifyAllSubscribers('SIGNED_OUT', null)
      }
      return { error: revokeError }
    })
  }

  /**
   * Subscribes to auth-state changes for this client.
   *
   * The callback fires for `INITIAL_SESSION` once shortly after subscribing
   * (so consumers don't have to special-case "no event yet"), and then for
   * every `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `PASSWORD_RECOVERY`,
   * and `USER_UPDATED` event. Events are broadcast across tabs through
   * `BroadcastChannel`, so a sign-in or sign-out in one tab reaches every
   * other tab using the same `storageKey`.
   *
   * @param callback Invoked with the event name and the new session (or
   *   `null` on `SIGNED_OUT`). Can return a promise — the SDK awaits it.
   * @returns `{ data: { subscription } }` — call `subscription.unsubscribe()`
   *   to stop listening.
   * @example
   * ```ts
   * const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
   *   if (event === 'SIGNED_IN') console.log('Welcome', session?.user.email)
   * })
   * // later
   * subscription.unsubscribe()
   * ```
   * @see {@link https://faable.com/docs/auth/get-started | Get Started with Faable Auth}
   * @category Sessions
   */
  onAuthStateChange(
    callback: (
      event: AuthChangeEvent,
      session: Session | null
    ) => void | Promise<void>
  ): {
    data: { subscription: Subscription }
  } {
    const { subscription } = this.broadcastSync.subscribe(callback)
    this._debug(
      '#onAuthStateChange()',
      'registered callback with id',
      subscription.id
    )
    ;(async () => {
      await this.initializePromise
      await this.lock._acquireLock(-1, async () => {
        this._emitInitialSession(subscription)
      })
    })()

    return { data: { subscription } }
  }

  private async _emitInitialSession(subscription: Subscription): Promise<void> {
    return await this._useSession(async result => {
      try {
        const {
          data: { session },
          error
        } = result
        if (error) throw error

        await subscription.callback('INITIAL_SESSION', session)
        this._debug(
          'INITIAL_SESSION',
          'callback id',
          subscription.id,
          'session',
          session
        )
      } catch (err) {
        await subscription.callback('INITIAL_SESSION', null)
        this._debug(
          'INITIAL_SESSION',
          'callback id',
          subscription.id,
          'error',
          err
        )
        console.error(err)
      }
    })
  }

  /**
   * Forces a new session by exchanging a refresh token regardless of expiry.
   *
   * Normally the SDK handles refresh transparently via the auto-refresh
   * ticker; call this only when you need to force an immediate refresh —
   * e.g. right after a server-side action that changed the user's claims.
   * Omit `currentSession` to reuse whatever {@link FaableAuthClient.getSession}
   * returns.
   *
   * @param currentSession Optional session shape carrying the refresh token
   *   to exchange. When passed it must include `refresh_token`.
   * @example
   * ```ts
   * const { data, error } = await auth.refreshSession()
   * ```
   * @see {@link https://faable.com/docs/auth/oauth-flows/refresh-token | Refresh Token}
   * @category Sessions
   */
  async refreshSession(currentSession?: {
    refresh_token: string
  }): Promise<AuthResponse> {
    await this.initializePromise

    return await this.lock._acquireLock(-1, async () => {
      return await this._refreshSession(currentSession)
    })
  }

  protected async _refreshSession(currentSession?: {
    refresh_token: string
  }): Promise<AuthResponse> {
    try {
      return await this._useSession(async result => {
        if (!currentSession) {
          const { data, error } = result
          if (error) {
            throw error
          }

          currentSession = data.session ?? undefined
        }

        if (!currentSession?.refresh_token) {
          throw new AuthSessionMissingError()
        }

        const { session, error } = await this._callRefreshToken(
          currentSession.refresh_token
        )
        if (error) {
          return { data: { user: null, session: null }, error: error }
        }

        if (!session) {
          return { data: { user: null, session: null }, error: null }
        }

        return { data: { user: (session as any).user, session }, error: null }
      })
    } catch (error) {
      if (isAuthError(error)) {
        return { data: { user: null, session: null }, error }
      }

      throw error
    }
  }
}
