import {
  FaableAuthClient,
  cookieStorageAdapter,
  getSessionFromCookies
} from './FaableAuthClient'
import { createClient } from './createClient'
import { AuthError } from './lib/errors'
import { Session, User } from './lib/types'
import type {
  AuthChangeEvent,
  AuthFlowType,
  AuthResponse,
  CookieOptions,
  FaableAuthClientConfig,
  OAuthResponse,
  Provider,
  SignInWithOAuthConnection,
  SignOut,
  Subscription,
  SupportedStorage
} from './lib/types'

export {
  Session,
  User,
  FaableAuthClient,
  AuthError,
  createClient,
  cookieStorageAdapter,
  getSessionFromCookies
}

export type {
  FaableAuthClientConfig,
  SignInWithOAuthConnection,
  AuthResponse,
  AuthChangeEvent,
  Subscription,
  SignOut,
  SupportedStorage,
  CookieOptions,
  OAuthResponse,
  AuthFlowType,
  Provider
}
