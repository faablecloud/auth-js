import {
  FaableAuthClient,
  cookieStorageAdapter,
  getSessionFromCookies
} from './FaableAuthClient'
import type { RedirectError, SignOutReason } from './FaableAuthClient'
import { createClient } from './createClient'
import { hasPermissions, hasRoles, permissionsOf } from './lib/claims'
import {
  AuthApiError,
  AuthError,
  AuthLoginRequiredError,
  AuthMfaRequiredError,
  isAuthApiError,
  isAuthLoginRequiredError,
  isAuthMfaRequiredError
} from './lib/errors'
import type {
  LastUsedLoginMethod,
  LastUsedLoginMethodKind
} from './lib/last_used_storage'
import type { PendingPasswordless } from './lib/pending_passwordless'
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
  ProfileField,
  ProfileUpdate,
  Provider,
  SignInWithOAuthConnection,
  SignOut,
  SignupLoginOptions,
  SignupParams,
  SignupResult,
  Subscription,
  SupportedStorage,
  UserConnection,
  UserCredentials,
  UserSession,
  UserSessions
} from './lib/types'
import { unwrap } from './lib/unwrap'

export {
  Session,
  User,
  FaableAuthClient,
  AuthApiError,
  AuthError,
  AuthLoginRequiredError,
  AuthMfaRequiredError,
  isAuthApiError,
  isAuthLoginRequiredError,
  isAuthMfaRequiredError,
  createClient,
  cookieStorageAdapter,
  getSessionFromCookies,
  unwrap,
  permissionsOf,
  hasPermissions,
  hasRoles
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
  RedirectError,
  PendingPasswordless,
  JwtClaims,
  SignupParams,
  SignupLoginOptions,
  SignupResult,
  ProfileField,
  ProfileUpdate,
  UserConnection,
  UserCredentials,
  UserSession,
  UserSessions
}
