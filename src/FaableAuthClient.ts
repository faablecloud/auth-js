import { getDomain, getTokenIssuer } from "./utils";

import {
  AuthFlowType,
  SupportedStorage,
  SignInWithOAuthConnection,
  OAuthResponse,
  Subscription,
  InitializeResult,
  User,
  CallRefreshTokenResult,
} from "./lib/types";

import { decodeJWTPayload, verify as verifyIdToken } from "./lib/jwt";
import {
  FaableAuthClientConfig,
  AuthResponse,
  AuthChangeEvent,
} from "./lib/types";
import { TokenEndpointResponse, Session, SignOut } from "./lib/types";
import {
  Deferred,
  RawAuthResponse,
  _sessionResponse,
  checkExpiresInTime,
  getCodeChallengeAndMethod,
  isBrowser,
  retryable,
  sleep,
  uuid,
} from "./lib/helpers";

import { EXPIRY_MARGIN, STORAGE_KEY } from "./lib/constants";
import { localStorageAdapter } from "./lib/local-storage";
import {
  AuthError,
  AuthImplicitGrantRedirectError,
  AuthInvalidTokenResponseError,
  AuthPKCEGrantCodeExchangeError,
  AuthSessionMissingError,
  AuthUnknownError,
  isAuthApiError,
  isAuthError,
  isAuthRetryableFetchError,
} from "./lib/errors";
import {
  getItemAsync,
  removeItemAsync,
  setItemAsync,
} from "./lib/storage_helpers";
import FaableAuthApi from "./FaableAuthApi";
import { LockAcquireTimeoutError } from "./lock/locks";
import { _get, _post } from "./lib/fetch";
import { Base } from "./Base";
import { Lock } from "./lock/Lock";
import { document, window } from "./lib/globals";
import { clearURLParameters, parseParametersFromURL } from "./lib/url_helpers";
import { windowHelpers } from "./lib/helpers/window";

/** Current session will be checked for refresh at this interval. */
const AUTO_REFRESH_TICK_DURATION = 30 * 1000;

/**
 * A token refresh will be attempted this many ticks before the current session expires. */
const AUTO_REFRESH_TICK_THRESHOLD = 3;

export class FaableAuthClient extends Base {
  domainUrl: string;
  tokenIssuer: string;
  redirect_uri: string;
  scope?: string;
  sessionCheckExpiryDays: number;

  protected initializePromise: Promise<InitializeResult> | null = null;
  protected detectSessionInUrl = true;

  protected storageKey: string;

  protected clientId: string;
  protected storage: SupportedStorage;
  protected api: FaableAuthApi;

  protected autoRefreshToken: boolean;
  protected autoRefreshTicker: ReturnType<typeof setInterval> | null = null;
  protected visibilityChangedCallback: (() => Promise<any>) | null = null;

  protected refreshingDeferred: Deferred<CallRefreshTokenResult> | null = null;

  /**
   * Used to broadcast state change events to other tabs listening.
   */
  protected broadcastChannel: BroadcastChannel | null = null;
  protected stateChangeEmitters: Map<string, Subscription> = new Map();

  protected lock: Lock;

  constructor(config: FaableAuthClientConfig) {
    const debug = config?.debug || false;
    super({ debug });

    this.sessionCheckExpiryDays = 1;
    this.redirect_uri = config?.redirect_uri || "";
    if (!config?.domain) {
      throw new Error("Missing domain");
    }
    this.domainUrl = getDomain(config.domain);

    this.tokenIssuer = getTokenIssuer("", this.domainUrl);
    if (!config.clientId) {
      throw new Error("Missing clientId");
    }
    this.clientId = config.clientId;

    this.api = new FaableAuthApi(this.domainUrl, { debug });

    // Storage key
    const key_prefix = config?.storageKey || STORAGE_KEY;
    this.storageKey = `${key_prefix}-${this.clientId}`;

    this.storage = config?.storage || localStorageAdapter;

    this.lock = new Lock({
      lock: config.lock,
      storageKey: this.storageKey,
      debug: config.debug,
    });

    if (
      isBrowser() &&
      globalThis.BroadcastChannel &&
      // this.persistSession &&
      this.storageKey
    ) {
      try {
        this.broadcastChannel = new globalThis.BroadcastChannel(
          this.storageKey
        );
      } catch (e: any) {
        console.error(
          "Failed to create a new BroadcastChannel, multi-tab state changes will not be available",
          e
        );
      }

      this.broadcastChannel?.addEventListener("message", async (event) => {
        this._debug(
          "received broadcast notification from other tab or client",
          event
        );

        await this._notifyAllSubscribers(
          event.data.event,
          event.data.session,
          false
        ); // broadcast = false so we don't get an endless loop of messages
      });
    }

    this.autoRefreshToken = true;

    this.initialize();
  }

  /**
   * Initializes the client session either from the url or from storage.
   * This method is automatically called when instantiating the client, but should also be called
   * manually when checking for an error from an auth redirect (oauth, magiclink, password recovery, etc).
   */
  async initialize(): Promise<InitializeResult> {
    if (this.initializePromise) {
      return await this.initializePromise;
    }

    this.initializePromise = (async () => {
      return await this.lock._acquireLock(-1, async () => {
        return await this._initialize();
      });
    })();

    return await this.initializePromise;
  }

  /**
   * IMPORTANT:
   * 1. Never throw in this method, as it is called from the constructor
   * 2. Never return a session from this method as it would be cached over
   *    the whole lifetime of the client
   */
  private async _initialize(): Promise<InitializeResult> {
    try {
      const flow = await this._detectFlowType();

      this._debug("#_initialize()", "begin", "flow_type", flow);

      // if exists any flow, process the session
      if (flow) {
        const { data, error } = await this._getSessionFromURL(flow);
        if (error) {
          this._debug(
            "#_initialize()",
            "error detecting session from URL",
            error
          );

          // hacky workaround to keep the existing session if there's an error returned from identity linking
          // TODO: once error codes are ready, we should match against it instead of the message
          if (
            error?.message === "Identity is already linked" ||
            error?.message === "Identity is already linked to another user"
          ) {
            return { error };
          }

          // failed login attempt via url,
          // remove old session as in verifyOtp, signUp and signInWith*
          await this._removeSession();

          return { error };
        }

        const { session, redirectType } = data;

        this._debug(
          "#_initialize()",
          "detected session in URL",
          session,
          "redirect type",
          redirectType
        );

        await this._saveSession(session);

        setTimeout(async () => {
          if (redirectType === "recovery") {
            await this._notifyAllSubscribers("PASSWORD_RECOVERY", session);
          } else {
            await this._notifyAllSubscribers("SIGNED_IN", session);
          }
        }, 0);

        return { error: null };
      }
      // no login attempt via callback url try to recover session from storage
      await this._recoverAndRefresh();
      return { error: null };
    } catch (error) {
      if (isAuthError(error)) {
        return { error };
      }

      return {
        error: new AuthUnknownError(
          "Unexpected error during initialization",
          error
        ),
      };
    } finally {
      await this._handleVisibilityChange();
      this._debug("#_initialize()", "end");
    }
  }

  /**
   * Gets the session data from a URL string
   */
  private async _getSessionFromURL(flow: AuthFlowType): Promise<
    | {
        data: { session: Session; redirectType: string | null };
        error: null;
      }
    | { data: { session: null; redirectType: null }; error: AuthError }
  > {
    try {
      const params = parseParametersFromURL(window.location.href);
      if (flow == "pkce") {
        if (!params.code) {
          throw new AuthPKCEGrantCodeExchangeError("No code detected.");
        }

        const { data, error } = await this._exchangeCodeForSession(params.code);
        if (error) throw error;

        // Remove code from URL
        clearURLParameters(["code"]);

        return {
          data: { session: data.session, redirectType: null },
          error: null,
        };
      }

      if (params.error || params.error_description || params.error_code) {
        throw new AuthImplicitGrantRedirectError(
          params.error_description ||
            "Error in URL with unspecified error_description",
          {
            error: params.error || "unspecified_error",
            code: params.error_code || "unspecified_code",
          }
        );
      }

      const {
        provider_token,
        provider_refresh_token,
        access_token,
        refresh_token,
        expires_in,
        expires_at,
        token_type,
      } = params;

      if (!access_token || !expires_in || !refresh_token || !token_type) {
        throw new AuthImplicitGrantRedirectError("No session defined in URL");
      }

      // Check time is valid
      const { expiresAt, expiresIn } = checkExpiresInTime({
        expires_in,
        expires_at,
        refreshTick: AUTO_REFRESH_TICK_DURATION,
      });

      const { data, error } = await this._getUser(access_token);

      if (error || !data.user) throw error;

      const session: Session = {
        provider_token,
        provider_refresh_token,
        access_token,
        expires_in: expiresIn,
        expires_at: expiresAt,
        refresh_token,
        token_type,
        user: data.user,
      };

      // Remove tokens from URL
      clearURLParameters([
        "access_token",
        "expires_in",
        "refresh_token",
        "token_type",
        "scope",
      ]);
      this._debug("#_getSessionFromURL()", "clearing window.location.hash");

      return { data: { session, redirectType: params.type }, error: null };
    } catch (error) {
      this._debug(error);
      if (isAuthError(error)) {
        return { data: { session: null, redirectType: null }, error };
      }
      throw error;
    }
  }

  private async _exchangeCodeForSession(authCode: string): Promise<
    | {
        data: { session: Session; user: User; redirectType: string | null };
        error: null;
      }
    | {
        data: { session: null; user: null; redirectType: null };
        error: AuthError;
      }
  > {
    const storageItem = await getItemAsync(
      this.storage,
      `${this.storageKey}-code-verifier`
    );
    const [codeVerifier, redirectType] = ((storageItem ?? "") as string).split(
      "/"
    );

    const rawResponse = await _post<Partial<RawAuthResponse>>(
      `${this.domainUrl}/oauth/token`,
      {
        client_id: this.clientId,
        grant_type: "authorization_code",
        code: authCode,
        code_verifier: codeVerifier,
      }
    );

    const { data, error } = _sessionResponse(rawResponse);

    if (!data) {
      throw new Error("Missing data");
    }

    await removeItemAsync(this.storage, `${this.storageKey}-code-verifier`);
    if (error) {
      return { data: { user: null, session: null, redirectType: null }, error };
    } else if (!data || !data.session || !data.user) {
      return {
        data: { user: null, session: null, redirectType: null },
        error: new AuthInvalidTokenResponseError(),
      };
    }
    let session = data.session as Session;
    if (session) {
      const { data: userdata, error } = await this._getUser(
        session.access_token
      );
      if (error || !userdata.user) {
        throw error;
      }

      session = {
        ...session,
        user: userdata.user,
      };
      data.session = session;

      await this._saveSession(session);
      await this._notifyAllSubscribers("SIGNED_IN", session);
    }
    return {
      data: { ...data, redirectType: redirectType ?? null } as any,
      error,
    };
  }

  /**
   * Registers callbacks on the browser / platform, which in-turn run
   * algorithms when the browser window/tab are in foreground. On non-browser
   * platforms it assumes always foreground.
   */
  private async _handleVisibilityChange() {
    this._debug("#_handleVisibilityChange()");

    if (!isBrowser() || !window?.addEventListener) {
      if (this.autoRefreshToken) {
        // in non-browser environments the refresh token ticker runs always
        this.startAutoRefresh();
      }

      return false;
    }

    try {
      this.visibilityChangedCallback = async () =>
        await this._onVisibilityChanged(false);

      window?.addEventListener(
        "visibilitychange",
        this.visibilityChangedCallback
      );

      // now immediately call the visbility changed callback to setup with the
      // current visbility state
      await this._onVisibilityChanged(true); // initial call
    } catch (error) {
      console.error("_handleVisibilityChange", error);
    }
  }

  /**
   * Callback registered with `window.addEventListener('visibilitychange')`.
   */
  private async _onVisibilityChanged(calledFromInitialize: boolean) {
    const methodName = `#_onVisibilityChanged(${calledFromInitialize})`;
    this._debug(methodName, "visibilityState", document.visibilityState);

    if (document.visibilityState === "visible") {
      if (this.autoRefreshToken) {
        // in browser environments the refresh token ticker runs only on focused tabs
        // which prevents race conditions
        this._startAutoRefresh();
      }

      if (!calledFromInitialize) {
        // called when the visibility has changed, i.e. the browser
        // transitioned from hidden -> visible so we need to see if the session
        // should be recovered immediately... but to do that we need to acquire
        // the lock first asynchronously
        await this.initializePromise;

        await this.lock._acquireLock(-1, async () => {
          if (document.visibilityState !== "visible") {
            this._debug(
              methodName,
              "acquired the lock to recover the session, but the browser visibilityState is no longer visible, aborting"
            );

            // visibility has changed while waiting for the lock, abort
            return;
          }

          // recover the session
          await this._recoverAndRefresh();
        });
      }
    } else if (document.visibilityState === "hidden") {
      if (this.autoRefreshToken) {
        this._stopAutoRefresh();
      }
    }
  }

  /**
   * Recovers the session from LocalStorage and refreshes
   * Note: this method is async to accommodate for AsyncStorage e.g. in React native.
   */
  private async _recoverAndRefresh() {
    const debugName = "#_recoverAndRefresh()";
    this._debug(debugName, "begin");

    try {
      const currentSession = await getItemAsync(this.storage, this.storageKey);
      this._debug(debugName, "session from storage", currentSession);

      if (!this._isValidSession(currentSession)) {
        this._debug(debugName, "session is not valid");
        if (currentSession !== null) {
          await this._removeSession();
        }

        return;
      }

      const timeNow = Math.round(Date.now() / 1000);
      const expiresWithMargin =
        (currentSession.expires_at ?? Infinity) < timeNow + EXPIRY_MARGIN;

      this._debug(
        debugName,
        `session has${
          expiresWithMargin ? "" : " not"
        } expired with margin of ${EXPIRY_MARGIN}s`
      );

      if (expiresWithMargin) {
        if (this.autoRefreshToken && currentSession.refresh_token) {
          const { error } = await this._callRefreshToken(
            currentSession.refresh_token
          );

          if (error) {
            console.error(error);

            if (!isAuthRetryableFetchError(error)) {
              this._debug(
                debugName,
                "refresh failed with a non-retryable error, removing the session",
                error
              );
              await this._removeSession();
            }
          }
        }
      } else {
        // no need to persist currentSession again, as we just loaded it from
        // local storage; persisting it again may overwrite a value saved by
        // another client with access to the same local storage
        await this._notifyAllSubscribers("SIGNED_IN", currentSession);
      }
    } catch (err) {
      this._debug(debugName, "error", err);

      console.error(err);
      return;
    } finally {
      this._debug(debugName, "end");
    }
  }

  /**
   * Removes any registered visibilitychange callback.
   *
   * {@see #startAutoRefresh}
   * {@see #stopAutoRefresh}
   */
  private _removeVisibilityChangedCallback() {
    this._debug("#_removeVisibilityChangedCallback()");

    const callback = this.visibilityChangedCallback;
    this.visibilityChangedCallback = null;

    try {
      if (callback && isBrowser() && window?.removeEventListener) {
        window.removeEventListener("visibilitychange", callback);
      }
    } catch (e) {
      console.error("removing visibilitychange callback failed", e);
    }
  }

  /**
   * Starts an auto-refresh process in the background. The session is checked
   * every few seconds. Close to the time of expiration a process is started to
   * refresh the session. If refreshing fails it will be retried for as long as
   * necessary.
   *
   * If you set the {@link GoTrueClientOptions#autoRefreshToken} you don't need
   * to call this function, it will be called for you.
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
    this._removeVisibilityChangedCallback();
    await this._startAutoRefresh();
  }

  /**
   * This is the private implementation of {@link #startAutoRefresh}. Use this
   * within the library.
   */
  private async _startAutoRefresh() {
    await this._stopAutoRefresh();

    this._debug("#_startAutoRefresh()");

    const ticker = setInterval(
      () => this._autoRefreshTokenTick(),
      AUTO_REFRESH_TICK_DURATION
    );
    this.autoRefreshTicker = ticker;

    if (
      ticker &&
      typeof ticker === "object" &&
      typeof ticker.unref === "function"
    ) {
      // ticker is a NodeJS Timeout object that has an `unref` method
      // https://nodejs.org/api/timers.html#timeoutunref
      // When auto refresh is used in NodeJS (like for testing) the
      // `setInterval` is preventing the process from being marked as
      // finished and tests run endlessly. This can be prevented by calling
      // `unref()` on the returned object.
      ticker.unref();
      // @ts-ignore
    } else if (
      typeof (globalThis as any).Deno !== "undefined" &&
      typeof (globalThis as any).Deno.unrefTimer === "function"
    ) {
      // similar like for NodeJS, but with the Deno API
      // https://deno.land/api@latest?unstable&s=Deno.unrefTimer
      // @ts-ignore
      Deno.unrefTimer(ticker);
    }

    // run the tick immediately, but in the next pass of the event loop so that
    // #_initialize can be allowed to complete without recursively waiting on
    // itself
    setTimeout(async () => {
      await this.initializePromise;
      await this._autoRefreshTokenTick();
    }, 0);
  }

  /**
   * This is the private implementation of {@link #stopAutoRefresh}. Use this
   * within the library.
   */
  private async _stopAutoRefresh() {
    this._debug("#_stopAutoRefresh()");

    const ticker = this.autoRefreshTicker;
    this.autoRefreshTicker = null;

    if (ticker) {
      clearInterval(ticker);
    }
  }

  /**
   * Runs the auto refresh token tick.
   */
  private async _autoRefreshTokenTick() {
    this._debug("#_autoRefreshTokenTick()", "begin");

    try {
      await this.lock._acquireLock(0, async () => {
        try {
          const now = Date.now();

          try {
            return await this._useSession(async (result) => {
              const {
                data: { session },
              } = result;

              if (!session || !session.refresh_token || !session.expires_at) {
                this._debug("#_autoRefreshTokenTick()", "no session");
                return;
              }

              // session will expire in this many ticks (or has already expired if <= 0)
              const expiresInTicks = Math.floor(
                (session.expires_at * 1000 - now) / AUTO_REFRESH_TICK_DURATION
              );

              this._debug(
                "#_autoRefreshTokenTick()",
                `access token expires in ${expiresInTicks} ticks, a tick lasts ${AUTO_REFRESH_TICK_DURATION}ms, refresh threshold is ${AUTO_REFRESH_TICK_THRESHOLD} ticks`
              );

              if (expiresInTicks <= AUTO_REFRESH_TICK_THRESHOLD) {
                await this._callRefreshToken(session.refresh_token);
              }
            });
          } catch (e: any) {
            console.error(
              "Auto refresh tick failed with error. This is likely a transient error.",
              e
            );
          }
        } finally {
          this._debug("#_autoRefreshTokenTick()", "end");
        }
      });
    } catch (e: any) {
      if (e.isAcquireTimeout || e instanceof LockAcquireTimeoutError) {
        this._debug("auto refresh token tick lock not available");
      } else {
        throw e;
      }
    }
  }

  // /**
  //  * Checks if the current URL and backing storage contain parameters given by a PKCE flow
  //  */
  // private async _isPKCEFlow(): Promise<boolean> {
  //   const params = parseParametersFromURL(window.location.href);

  //   const currentStorageContent = await getItemAsync(
  //     this.storage,
  //     `${this.storageKey}-code-verifier`
  //   );

  //   return !!(params.code && currentStorageContent);
  // }

  // /**
  //  * Checks if the current URL contains parameters given by an implicit oauth grant flow (https://www.rfc-editor.org/rfc/rfc6749.html#section-4.2)
  //  */
  // private _isImplicitGrantFlow(): boolean {
  //   const params = parseParametersFromURL(window.location.href);

  //   return !!(isBrowser() && (params.access_token || params.error_description));
  // }

  private async _detectFlowType(): Promise<AuthFlowType | null> {
    const params = parseParametersFromURL(window.location.href);

    const browser = isBrowser();

    // PKCE
    if (browser && params.code) {
      return "pkce";
    }

    // Implicit
    if (browser && (params.access_token || params.error_description)) {
      return "implicit";
    }
    return null;
  }

  private _scope() {
    return this.scope || "openid profile email";
  }

  private async _getUrlForConnection(
    url: string,
    params: {
      connection?: string;
      redirectTo?: string;
      scopes?: string;
      response_type?: "code" | "token";
      queryParams?: { [key: string]: string };
      skipBrowserRedirect?: boolean;
    }
  ) {
    let urlParams: Record<string, any> = params.queryParams || {};

    const authorize_params: Record<string, any> = {
      client_id: this.clientId,
      response_type: params.response_type,
      redirect_uri:
        params.redirectTo || this.redirect_uri || window.location.origin,
      scope: params.scopes || this._scope(),
    };

    const flowType = await this._detectFlowType();

    if (flowType === "pkce") {
      const [codeChallenge, codeChallengeMethod] =
        await getCodeChallengeAndMethod(this.storage, this.storageKey);

      urlParams = {
        ...urlParams,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
      };
    }

    // Set connection if specified
    if (params.connection) {
      authorize_params.connection = params.connection;
    }

    // Merge authorize params with urlParams
    return `${url}?${new URLSearchParams({
      ...urlParams,
      ...authorize_params,
    })}`;
  }

  async signInWithOauthConnection(
    credentials: SignInWithOAuthConnection
  ): Promise<OAuthResponse> {
    return await this._handleConnectionSignIn({
      connection: credentials.connection,
      redirectTo: credentials?.redirectTo,
      scopes: credentials?.scopes,
      queryParams: credentials.queryParams,
      skipBrowserRedirect: credentials.skipBrowserRedirect,
    });
  }

  async signInWithUsernamePassword(data: {
    username: string;
    password: string;
    redirect_uri?: string;
  }) {
    // Handle response and submit
    const handleCallback = async (formHtml: string) => {
      console.log("rawres");
      console.log(rawAuthResponse);
      const div = document.createElement("div");
      div.innerHTML = formHtml;
      const form = document.body.appendChild(div)
        .children[0] as HTMLFormElement;

      form.submit();
    };

    const rawAuthResponse = await _post<string>(
      `${this.domainUrl}/usernamepassword/login`,
      {
        username: data.username,
        password: data.password,
        redirect_uri:
          data.redirect_uri || this.redirect_uri || window.location.origin,
        client_id: this.clientId,
      },
      { raw: true }
    );

    if (!rawAuthResponse.data || rawAuthResponse.error) {
      throw new Error(
        rawAuthResponse.error || "Error in username password login"
      );
    }
    handleCallback(rawAuthResponse.data);
  }

  async changePassword(params: { email: string }) {
    if (!params?.email) {
      throw new Error("email is required");
    }

    const { data, error } = await _post(
      `${this.domainUrl}/dbconnections/change_password`,
      {
        email: params.email,
      }
    );
    return data;
  }

  buildAuthorizeUrl(
    options: {
      redirectTo?: string;
      scope?: string;
      response_type?: string;
      audience?: string;
    } = {}
  ): string {
    const params = {
      client_id: this.clientId,
      redirect_uri:
        options.redirectTo || this.redirect_uri || window.location.origin,
      response_type: options.response_type || isBrowser() ? "code" : "token",
      audience: options.audience,
      scope: options.scope,
    };

    // Create a new object with only non-empty properties
    const y = Object.fromEntries(
      Object.entries(params).filter(([key, value]) => !!value)
    ) as Record<string, string>;

    return `${this.domainUrl}/authorize?${new URLSearchParams(y).toString()}`;
  }

  authorize(options: {
    redirectTo?: string;
    scope?: string;
    response_type: string;
    audience?: string;
  }) {
    const url = this.buildAuthorizeUrl(options);
    windowHelpers.redirect(url);
  }

  private async _handleConnectionSignIn(options: {
    connection?: string;
    redirectTo?: string;
    scopes?: string;
    queryParams?: { [key: string]: string };
    skipBrowserRedirect?: boolean;
  }) {
    const url: string = await this._getUrlForConnection(
      `${this.domainUrl}/authorize`,
      {
        response_type: isBrowser() ? "code" : "token",
        connection: options.connection,
        redirectTo: options.redirectTo,
        scopes: options.scopes,
        queryParams: options.queryParams,
      }
    );

    this._debug("#_handleProviderSignIn()", "options", options, "url", url);

    // try to open on the browser
    if (isBrowser() && !options.skipBrowserRedirect) {
      window.location.assign(url);
    }

    return { data: { url }, error: null };
  }

  /**
   * Sets the session data from the current session. If the current session is expired, setSession will take care of refreshing it to obtain a new session.
   * If the refresh token or access token in the current session is invalid, an error will be thrown.
   * @param currentSession The current session that minimally contains an access token and refresh token.
   */
  async setSession(currentSession: {
    access_token: string;
    refresh_token: string;
  }): Promise<AuthResponse> {
    await this.initializePromise;

    return await this.lock._acquireLock(-1, async () => {
      return await this._setSession(currentSession);
    });
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
    await this.initializePromise;

    const result = await this.lock._acquireLock(-1, async () => {
      return this._useSession(async (result) => {
        return result;
      });
    });

    return result;
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
              session: Session;
            };
            error: null;
          }
        | {
            data: {
              session: null;
            };
            error: AuthError;
          }
        | {
            data: {
              session: null;
            };
            error: null;
          }
    ) => Promise<R>
  ): Promise<R> {
    this._debug("#_useSession", "begin");

    try {
      // the use of __loadSession here is the only correct use of the function!
      const result = await this.__loadSession();

      return await fn(result);
    } finally {
      this._debug("#_useSession", "end");
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
          session: Session;
        };
        error: null;
      }
    | {
        data: {
          session: null;
        };
        error: AuthError;
      }
    | {
        data: {
          session: null;
        };
        error: null;
      }
  > {
    this._debug("#__loadSession()", "begin");

    if (!this.lock.lockAcquired) {
      this._debug(
        "#__loadSession()",
        "used outside of an acquired lock!",
        new Error().stack
      );
    }

    try {
      let currentSession: Session | null = null;

      const maybeSession = await getItemAsync(this.storage, this.storageKey);

      this._debug("#getSession()", "session from storage", maybeSession);

      if (maybeSession !== null) {
        if (this._isValidSession(maybeSession)) {
          currentSession = maybeSession;
        } else {
          this._debug("#getSession()", "session from storage is not valid");
          await this._removeSession();
        }
      }

      if (!currentSession) {
        return { data: { session: null }, error: null };
      }

      const hasExpired = currentSession.expires_at
        ? currentSession.expires_at <= Date.now() / 1000
        : false;

      this._debug(
        "#__loadSession()",
        `session has${hasExpired ? "" : " not"} expired`,
        "expires_at",
        currentSession.expires_at
      );

      if (!hasExpired) {
        if (this.storage.isServer) {
          const proxySession: Session = new Proxy(currentSession, {
            get(target: any, prop: string, receiver: any) {
              if (prop === "user") {
                // only show warning when the user object is being accessed from the server
                console.warn(
                  "Using the user object as returned from supabase.auth.getSession() or from some supabase.auth.onAuthStateChange() events could be insecure! This value comes directly from the storage medium (usually cookies on the server) and many not be authentic. Use supabase.auth.getUser() instead which authenticates the data by contacting the Supabase Auth server."
                );
              }
              return Reflect.get(target, prop, receiver);
            },
          });
          currentSession = proxySession;
        }

        return { data: { session: currentSession }, error: null };
      }

      const { session, error } = await this._callRefreshToken(
        currentSession.refresh_token
      );
      if (error) {
        return { data: { session: null }, error };
      }

      return { data: { session }, error: null };
    } finally {
      this._debug("#__loadSession()", "end");
    }
  }

  private async _removeSession() {
    this._debug("#_removeSession()");

    await removeItemAsync(this.storage, this.storageKey);
  }

  private _isValidSession(maybeSession: unknown): maybeSession is Session {
    const isValidSession =
      typeof maybeSession === "object" &&
      maybeSession !== null &&
      "access_token" in maybeSession &&
      "refresh_token" in maybeSession &&
      "expires_at" in maybeSession;

    return isValidSession;
  }

  protected async _setSession(currentSession: {
    access_token: string;
    refresh_token: string;
  }): Promise<AuthResponse> {
    try {
      if (!currentSession.access_token || !currentSession.refresh_token) {
        throw new AuthSessionMissingError();
      }

      const timeNow = Date.now() / 1000;
      let expiresAt = timeNow;
      let hasExpired = true;
      let session: Session | null = null;
      const payload = decodeJWTPayload(currentSession.access_token);
      if (payload.exp) {
        expiresAt = payload.exp;
        hasExpired = expiresAt <= timeNow;
      }

      if (hasExpired) {
        const { session: refreshedSession, error } =
          await this._callRefreshToken(currentSession.refresh_token);
        if (error) {
          return { data: { user: null, session: null }, error: error };
        }

        if (!refreshedSession) {
          return { data: { user: null, session: null }, error: null };
        }
        session = refreshedSession;
      } else {
        const { data, error } = await this._getUser(
          currentSession.access_token
        );
        if (error || !data.user) {
          throw error;
        }
        session = {
          access_token: currentSession.access_token,
          refresh_token: currentSession.refresh_token,
          user: data.user,
          token_type: "bearer",
          expires_in: expiresAt - timeNow,
          expires_at: expiresAt,
        };
        await this._saveSession(session);
        await this._notifyAllSubscribers("SIGNED_IN", session);
      }

      return { data: { user: session.user, session }, error: null };
    } catch (error) {
      if (isAuthError(error)) {
        return { data: { session: null, user: null }, error };
      }

      throw error;
    }
  }

  /**
   * set currentSession and currentUser
   * process to _startAutoRefreshToken if possible
   */
  private async _saveSession(session: Session) {
    this._debug("#_saveSession()", session);

    await setItemAsync(this.storage, this.storageKey, session);
  }

  private async _getUser(access_token: string) {
    if (!access_token) throw new Error("Cannot fetch user without token");
    this._debug("#_getUser() begin");
    const res = await _get<User>(`${this.domainUrl}/me`, {
      token: access_token,
    });
    this._debug("#_getUser() end");
    return { data: { user: res.data }, error: res.error };
  }

  private async _callRefreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new AuthSessionMissingError();
    }

    // refreshing is already in progress
    if (this.refreshingDeferred) {
      return this.refreshingDeferred.promise;
    }

    const debugName = `#_callRefreshToken(${refreshToken.substring(0, 5)}...)`;

    this._debug(debugName, "begin");

    try {
      this.refreshingDeferred = new Deferred<CallRefreshTokenResult>();

      const { data, error } = await this._refreshAccessToken(refreshToken);
      if (error) throw error;
      if (!data.session) throw new AuthSessionMissingError();

      await this._saveSession(data.session);
      await this._notifyAllSubscribers("TOKEN_REFRESHED", data.session);

      const result = { session: data.session, error: null };

      this.refreshingDeferred.resolve(result);

      return result;
    } catch (error) {
      this._debug(debugName, "error", error);

      if (isAuthError(error)) {
        const result = { session: null, error };

        if (!isAuthRetryableFetchError(error)) {
          await this._removeSession();
          await this._notifyAllSubscribers("SIGNED_OUT", null);
        }

        this.refreshingDeferred?.resolve(result);

        return result;
      }

      this.refreshingDeferred?.reject(error);
      throw error;
    } finally {
      this.refreshingDeferred = null;
      this._debug(debugName, "end");
    }
  }

  /**
   * Generates a new JWT.
   * @param refreshToken A valid refresh token that was returned on login.
   */
  private async _refreshAccessToken(
    refreshToken: string
  ): Promise<AuthResponse> {
    const debugName = `#_refreshAccessToken(${refreshToken.substring(
      0,
      5
    )}...)`;
    this._debug(debugName, "begin");

    try {
      const startedAt = Date.now();

      // will attempt to refresh the token with exponential backoff

      return await retryable(
        async (attempt) => {
          if (attempt > 0) {
            await sleep(200 * Math.pow(2, attempt - 1)); // 200, 400, 800, ...
          }

          this._debug(debugName, "refreshing attempt", attempt);

          // return await _post(`${this.url}/token?grant_type=refresh_token`, {
          //   body: { refresh_token: refreshToken },
          //   headers: this.headers,
          //   xform: _sessionResponse,
          // });
          const rawResponse = await _post<Partial<RawAuthResponse>>(
            `${this.domainUrl}/oauth/token`,
            {
              client_id: this.clientId,
              grant_type: "refresh_token",
              refresh_token: refreshToken,
            }
          );
          const session_res = _sessionResponse(rawResponse);

          if (!session_res.data.session?.access_token) {
            throw new Error("Bad user");
          }
          const user_res = await this._getUser(
            session_res.data.session?.access_token
          );

          const { data: user, error } = user_res;
          if (error) {
            throw new Error("Error requesting user");
          }
          if (!user) {
            throw new Error("No user found");
          }

          const x = {
            data: {
              session: {
                ...session_res.data.session,
                user,
              },
              user,
            },
            error: null,
          };
          // this._debug(x);
          return x;
        },
        (attempt, error) => {
          const nextBackOffInterval = 200 * Math.pow(2, attempt);
          return (
            error &&
            isAuthRetryableFetchError(error) &&
            // retryable only if the request can be sent before the backoff overflows the tick duration
            Date.now() + nextBackOffInterval - startedAt <
              AUTO_REFRESH_TICK_DURATION
          );
        }
      );
    } catch (error) {
      this._debug(debugName, "error", error);

      if (isAuthError(error)) {
        return { data: { session: null, user: null }, error };
      }
      throw error;
    } finally {
      this._debug(debugName, "end");
    }
  }

  private async _notifyAllSubscribers(
    event: AuthChangeEvent,
    session: Session | null,
    broadcast = true
  ) {
    const debugName = `#_notifyAllSubscribers(${event})`;
    this._debug(debugName, "begin", session, `broadcast = ${broadcast}`);

    try {
      if (this.broadcastChannel && broadcast) {
        this.broadcastChannel.postMessage({ event, session });
      }

      const errors: any[] = [];
      const promises = Array.from(this.stateChangeEmitters.values()).map(
        async (x) => {
          try {
            await x.callback(event, session);
          } catch (e: any) {
            errors.push(e);
          }
        }
      );

      await Promise.all(promises);

      if (errors.length > 0) {
        for (let i = 0; i < errors.length; i += 1) {
          console.error(errors[i]);
        }

        throw errors[0];
      }
    } finally {
      this._debug(debugName, "end");
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
    options: SignOut = { scope: "global" }
  ): Promise<{ error: AuthError | null }> {
    await this.initializePromise;

    return await this.lock._acquireLock(-1, async () => {
      return await this._signOut(options);
    });
  }

  protected async _signOut(
    { scope, returnTo }: SignOut & { returnTo?: string } = { scope: "global" }
  ): Promise<{ error: AuthError | null }> {
    return await this._useSession(async (result) => {
      const { data, error: sessionError } = result;
      if (sessionError) {
        return { error: sessionError };
      }
      const accessToken = data.session?.access_token;
      if (accessToken) {
        const { error } = await this.api.signOut({
          client_id: this.clientId,
        });
        if (error) {
          // ignore 404s since user might not exist anymore
          // ignore 401s since an invalid or expired JWT should sign out the current session
          if (
            !(
              isAuthApiError(error) &&
              (error.status === 404 || error.status === 401)
            )
          ) {
            return { error };
          }
        }
      }
      if (scope !== "others") {
        await this._removeSession();
        await removeItemAsync(this.storage, `${this.storageKey}-code-verifier`);
        await this._notifyAllSubscribers("SIGNED_OUT", null);
      }
      return { error: null };
    });
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
    data: { subscription: Subscription };
  } {
    const id: string = uuid();
    const subscription: Subscription = {
      id,
      callback,
      unsubscribe: () => {
        this._debug(
          "#unsubscribe()",
          "state change callback with id removed",
          id
        );

        this.stateChangeEmitters.delete(id);
      },
    };

    this._debug("#onAuthStateChange()", "registered callback with id", id);

    this.stateChangeEmitters.set(id, subscription);
    (async () => {
      await this.initializePromise;

      await this.lock._acquireLock(-1, async () => {
        this._emitInitialSession(id);
      });
    })();

    return { data: { subscription } };
  }

  private async _emitInitialSession(id: string): Promise<void> {
    return await this._useSession(async (result) => {
      try {
        const {
          data: { session },
          error,
        } = result;
        if (error) throw error;

        await this.stateChangeEmitters
          .get(id)
          ?.callback("INITIAL_SESSION", session);
        this._debug("INITIAL_SESSION", "callback id", id, "session", session);
      } catch (err) {
        await this.stateChangeEmitters
          .get(id)
          ?.callback("INITIAL_SESSION", null);
        this._debug("INITIAL_SESSION", "callback id", id, "error", err);
        console.error(err);
      }
    });
  }

  /**
   * Returns a new session, regardless of expiry status.
   * Takes in an optional current session. If not passed in, then refreshSession() will attempt to retrieve it from getSession().
   * If the current session's refresh token is invalid, an error will be thrown.
   * @param currentSession The current session. If passed in, it must contain a refresh token.
   */
  async refreshSession(currentSession?: {
    refresh_token: string;
  }): Promise<AuthResponse> {
    await this.initializePromise;

    return await this.lock._acquireLock(-1, async () => {
      return await this._refreshSession(currentSession);
    });
  }

  protected async _refreshSession(currentSession?: {
    refresh_token: string;
  }): Promise<AuthResponse> {
    try {
      return await this._useSession(async (result) => {
        if (!currentSession) {
          const { data, error } = result;
          if (error) {
            throw error;
          }

          currentSession = data.session ?? undefined;
        }

        if (!currentSession?.refresh_token) {
          throw new AuthSessionMissingError();
        }

        const { session, error } = await this._callRefreshToken(
          currentSession.refresh_token
        );
        if (error) {
          return { data: { user: null, session: null }, error: error };
        }

        if (!session) {
          return { data: { user: null, session: null }, error: null };
        }

        return { data: { user: (session as any).user, session }, error: null };
      });
    } catch (error) {
      if (isAuthError(error)) {
        return { data: { user: null, session: null }, error };
      }

      throw error;
    }
  }
}
