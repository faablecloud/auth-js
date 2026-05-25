import { Base } from './Base'
import FaableAuthApi from './FaableAuthApi'
import { buildAndSubmitForm, resolveResponseType } from './lib/auth_helpers'
import { BroadcastSync } from './lib/broadcast_sync'
import { EXPIRY_MARGIN, STORAGE_KEY } from './lib/constants'
import {
  AuthError,
  AuthImplicitGrantRedirectError,
  AuthInvalidTokenResponseError,
  AuthPKCEGrantCodeExchangeError,
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
import { decodeJWTPayload } from './lib/jwt'
import { getSessionFromCookies } from './lib/nextjs'
import { loadCodeVerifier } from './lib/pkce_storage'
import { isValidSession } from './lib/session_helpers'
import { cookieStorageAdapter } from './lib/storage/cookie-storage'
import { localStorageAdapter } from './lib/storage/local-storage'
import { getItemAsync, setItemAsync } from './lib/storage_helpers'
import {
  AuthFlowType,
  CallRefreshTokenResult,
  InitializeResult,
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

export class FaableAuthClient extends Base {
  domainUrl: string
  tokenIssuer: string
  redirectUri: string
  scope?: string
  sessionCheckExpiryDays: number

  protected initializePromise: Promise<InitializeResult> | null = null
  protected detectSessionInUrl = true

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

  protected lock: Lock

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

    this.api = new FaableAuthApi(this.domainUrl, { debug })

    // Storage key
    const key_prefix = config?.storageKey || STORAGE_KEY
    this.storageKey = `${key_prefix}-${this.clientId}`

    if (config?.cookieOptions) {
      this.storage = cookieStorageAdapter(config.cookieOptions)
    } else {
      this.storage = config?.storage || localStorageAdapter
    }

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

    this.autoRefreshToken = true

    this.initialize()
  }

  /**
   * Returns the current session, if any.
   */
  get session() {
    return this._session
  }

  /**
   * Initializes the client session either from the url or from storage.
   * This method is automatically called when instantiating the client, but should also be called
   * manually when checking for an error from an auth redirect (oauth, magiclink, password recovery, etc).
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

    return await this.initializePromise
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

          // failed login attempt via url,
          // remove old session as in verifyOtp, signUp and signInWith*
          await this._removeSession()

          return { error }
        }

        const { session, redirectType } = data

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

        return { error: null }
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
        data: { session: Session; redirectType: string | null }
        error: null
      }
    | { data: { session: null; redirectType: null }; error: AuthError }
  > {
    try {
      const params = parseParametersFromURL(window?.location.href)
      if (flow == 'pkce') {
        if (!params.code) {
          throw new AuthPKCEGrantCodeExchangeError('No code detected.')
        }

        const { data, error } = await this._exchangeCodeForSession(params.code)
        if (error) throw error

        // Remove code from URL
        clearURLParameters(['code'])

        return {
          data: { session: data.session, redirectType: null },
          error: null
        }
      }

      if (params.error || params.error_description || params.error_code) {
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

      if (!access_token || !expires_in || !refresh_token || !token_type) {
        throw new AuthImplicitGrantRedirectError('No session defined in URL')
      }

      // Check time is valid
      const { expiresAt, expiresIn } = checkExpiresInTime({
        expires_in,
        expires_at,
        refreshTick: AUTO_REFRESH_TICK_DURATION
      })

      const { data: user, error } = await this._getUser(access_token)

      if (error || !user) throw error

      const session: Session = {
        provider_token,
        provider_refresh_token,
        access_token,
        expires_in: expiresIn,
        expires_at: expiresAt,
        refresh_token,
        token_type,
        user
      }

      // Remove tokens from URL
      clearURLParameters([
        'access_token',
        'expires_in',
        'refresh_token',
        'token_type',
        'scope'
      ])
      this._debug('#_getSessionFromURL()', 'clearing window.location.hash')

      return { data: { session, redirectType: params.type }, error: null }
    } catch (error) {
      this._debug(error)
      if (isAuthError(error)) {
        return { data: { session: null, redirectType: null }, error }
      }
      throw error
    }
  }

  private async _exchangeCodeForSession(authCode: string): Promise<
    | {
        data: { session: Session; user: User; redirectType: string | null }
        error: null
      }
    | {
        data: { session: null; user: null; redirectType: null }
        error: AuthError
      }
  > {
    const stored = await loadCodeVerifier(
      this.storage,
      `${this.storageKey}-code-verifier`
    )
    if (!stored) {
      return {
        data: { user: null, session: null, redirectType: null },
        error: new AuthPKCEGrantCodeExchangeError(
          'No active PKCE code verifier — the authorization flow has expired or was not started'
        )
      }
    }
    const { verifier: codeVerifier, redirectType = null } = stored

    const rawResponse = await _post<Partial<RawAuthResponse>>(
      `${this.domainUrl}/oauth/token`,
      {
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code: authCode,
        code_verifier: codeVerifier
      }
    )

    const { data, error } = _sessionResponse(rawResponse)

    if (!data) {
      throw new Error('Missing data')
    }

    await this.storage.removeItem(`${this.storageKey}-code-verifier`)

    if (error) {
      return { data: { user: null, session: null, redirectType: null }, error }
    } else if (!data || !data.session || !data.user) {
      return {
        data: { user: null, session: null, redirectType: null },
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
      data: { ...data, redirectType: redirectType ?? null } as any,
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
   * {@see #startAutoRefresh}
   * {@see #stopAutoRefresh}
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
   * {@see #stopAutoRefresh}
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
      scopes?: string
      response_type?: 'code' | 'token'
      queryParams?: { [key: string]: string }
      skipBrowserRedirect?: boolean
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
        await getCodeChallengeAndMethod(this.storage, this.storageKey)

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

    return `${url}?${new URLSearchParams({
      ...urlParams,
      ...authorize_params
    })}`
  }

  async signInWithOauthConnection(
    credentials: SignInWithOAuthConnection
  ): Promise<OAuthResponse> {
    return await this._handleConnectionSignIn({
      connection: credentials.connection,
      connection_id: credentials.connection_id,
      redirectTo: credentials?.redirectTo,
      scopes: credentials?.scopes,
      queryParams: credentials.queryParams,
      skipBrowserRedirect: credentials.skipBrowserRedirect
    })
  }

  async signInWithUsernamePassword(data: {
    username: string
    password: string
    redirectTo?: string
    state?: string
  }): Promise<{ data: null; error: AuthError | null }> {
    const rawAuthResponse = await _post<string>(
      `${this.domainUrl}/usernamepassword/login`,
      {
        username: data.username,
        password: data.password,
        redirect_uri:
          data.redirectTo || this.redirectUri || window?.location.origin,
        client_id: this.clientId,
        state: data.state
      },
      { raw: true }
    )

    if (!rawAuthResponse.data || rawAuthResponse.error) {
      return {
        data: null,
        error: new AuthUnknownError(
          rawAuthResponse.error || 'Error in username password login',
          rawAuthResponse.error
        )
      }
    }
    buildAndSubmitForm(rawAuthResponse.data, document)
    return { data: null, error: null }
  }

  /**
   * Completes a passwordless login using an OTP code.
   * @param data The username and OTP code.
   */
  async signInWithOtp(data: {
    username: string
    otp: string
  }): Promise<AuthResponse> {
    const rawResponse = await _post<Partial<RawAuthResponse>>(
      `${this.domainUrl}/oauth/token`,
      {
        client_id: this.clientId,
        grant_type: 'http://auth0.com/oauth/grant-type/passwordless/otp',
        username: data.username,
        otp: data.otp
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

    return {
      data: { user: session.user, session },
      error: null
    }
  }

  /**
   * Starts a passwordless login flow by requesting an OTP code or a magic link.
   * @param data The email and the type of delivery (code or link).
   */
  async signInWithPasswordless(data: {
    email: string
    type: 'code' | 'link'
  }): Promise<{ data: any; error: AuthError | null }> {
    const response = await _post(`${this.domainUrl}/passwordless/start`, {
      client_id: this.clientId,
      email: data.email,
      send: data.type
    })

    return { data: response.data, error: response.error }
  }

  async changePassword(params: {
    email: string
  }): Promise<{ data: unknown; error: AuthError | null }> {
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

  buildAuthorizeUrl(
    options: {
      connection?: string
      redirectTo?: string
      scope?: string
      response_type?: string
      audience?: string
    } = {}
  ): string {
    const params: Record<string, string | undefined> = {
      client_id: this.clientId,
      redirect_uri:
        options.redirectTo || this.redirectUri || window?.location.origin,
      response_type: resolveResponseType(options, isBrowser()),
      audience: options.audience,
      scope: options.scope,
      connection: options.connection
    }

    const definedParams = Object.fromEntries(
      Object.entries(params).filter(([, value]) => !!value)
    ) as Record<string, string>

    return `${this.domainUrl}/authorize?${new URLSearchParams(definedParams).toString()}`
  }

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
    scopes?: string
    queryParams?: { [key: string]: string }
    skipBrowserRedirect?: boolean
  }) {
    const url: string = await this._getUrlForConnection(
      `${this.domainUrl}/authorize`,
      {
        response_type: isBrowser() ? 'code' : 'token',
        connection: options.connection,
        connection_id: options.connection_id,
        redirectTo: options.redirectTo,
        scopes: options.scopes,
        queryParams: options.queryParams
      }
    )

    this._debug('#_handleConnectionSignIn()', 'options', options, 'url', url)

    // try to open on the browser
    if (isBrowser() && !options.skipBrowserRedirect) {
      window?.location.assign(url)
    }

    return { data: { url }, error: null }
  }

  /**
   * Sets the session data from the current session. If the current session is expired, setSession will take care of refreshing it to obtain a new session.
   * If the refresh token or access token in the current session is invalid, an error will be thrown.
   * @param currentSession The current session that minimally contains an access token and refresh token.
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
   * The session returned can be null if the session is not detected which can happen in the event a user is not signed-in or has logged out.
   *
   * **IMPORTANT:** This method loads values directly from the storage attached
   * to the client. If that storage is based on request cookies for example,
   * the values in it may not be authentic and therefore it's strongly advised
   * against using this method and its results in such circumstances. A warning
   * will be emitted if this is detected. Use {@link #getUser()} instead.
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
    return { data: res.data, error: res.error }
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
              refresh_token: refreshToken
            }
          )
          if (rawResponse.error) {
            throw new AuthUnknownError(
              `Refresh token request failed: ${rawResponse.error}`,
              rawResponse.error
            )
          }
          const session_res = _sessionResponse(rawResponse)

          if (!session_res.data.session?.access_token) {
            throw new AuthInvalidTokenResponseError()
          }
          const { data: user, error } = await this._getUser(
            session_res.data.session?.access_token
          )

          if (error) {
            throw new AuthUnknownError('Could not fetch user info', error)
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
   * Inside a browser context, `signOut()` will remove the logged in user from the browser session and log them out - removing all items from localstorage and then trigger a `"SIGNED_OUT"` event.
   *
   * For server-side management, you can revoke all refresh tokens for a user by passing a user's JWT through to `auth.api.signOut(JWT: string)`.
   * There is no way to revoke a user's access token jwt until it expires. It is recommended to set a shorter expiry on the jwt for this reason.
   *
   * If using `others` scope, no `SIGNED_OUT` event is fired!
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
    { scope }: SignOut = { scope: 'global' }
  ): Promise<{ error: AuthError | null }> {
    return await this._useSession(async result => {
      const { data, error: sessionError } = result
      if (sessionError) {
        return { error: sessionError }
      }
      const accessToken = data.session?.access_token
      if (accessToken) {
        const { error } = await this.api.signOut({
          client_id: this.clientId
        })
        if (error) {
          // ignore 404s since user might not exist anymore
          // ignore 401s since an invalid or expired JWT should sign out the current session
          if (
            !(
              isAuthApiError(error) &&
              (error.status === 404 || error.status === 401)
            )
          ) {
            return { error }
          }
        }
      }
      if (scope !== 'others') {
        await this._removeSession()
        await this.storage.removeItem(`${this.storageKey}-code-verifier`)
        await this._notifyAllSubscribers('SIGNED_OUT', null)
      }
      return { error: null }
    })
  }

  /**
   * Receive a notification every time an auth event happens.
   * @param callback A callback function to be invoked when an auth event happens.
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
   * Returns a new session, regardless of expiry status.
   * Takes in an optional current session. If not passed in, then refreshSession() will attempt to retrieve it from getSession().
   * If the current session's refresh token is invalid, an error will be thrown.
   * @param currentSession The current session. If passed in, it must contain a refresh token.
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
