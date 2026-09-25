import {
  FaableAuthClient,
  cookieStorageAdapter,
  getSessionFromCookies
} from './FaableAuthClient'
import type { SignOutReason } from './FaableAuthClient'
import { createClient } from './createClient'
import {
  AuthError,
  AuthLoginRequiredError,
  AuthMfaRequiredError,
  isAuthLoginRequiredError,
  isAuthMfaRequiredError
} from './lib/errors'
import type {
  LastUsedLoginMethod,
  LastUsedLoginMethodKind
} from './lib/last_used_storage'
import { Session, User } from './lib/types'
import type {
  AuthChangeEvent,
  AuthFlowType,
  AuthResponse,
  AuthResult,
  CookieOptions,
  FaableAuthClientConfig,
  GetTokenSilently,
  JwtClaims,
  LastUsedCookieOptions,
  OAuthResponse,
  Provider,
  SignInWithOAuthConnection,
  SignOut,
  Subscription,
  SupportedStorage
} from './lib/types'
import { unwrap } from './lib/unwrap'

export {
  Session,
  User,
  FaableAuthClient,
  AuthError,
  AuthLoginRequiredError,
  AuthMfaRequiredError,
  isAuthLoginRequiredError,
  isAuthMfaRequiredError,
  createClient,
  cookieStorageAdapter,
  getSessionFromCookies,
  unwrap
}

export type {
  FaableAuthClientConfig,
  SignInWithOAuthConnection,
  AuthResponse,
  AuthResult,
  AuthChangeEvent,
  Subscription,
  SignOut,
  GetTokenSilently,
  SupportedStorage,
  CookieOptions,
  LastUsedCookieOptions,
  LastUsedLoginMethod,
  LastUsedLoginMethodKind,
  OAuthResponse,
  AuthFlowType,
  Provider,
  SignOutReason,
  JwtClaims
}
