import type { Session } from './types'

/**
 * Type guard for a stored session blob — checks the presence of the fields
 * the client needs to consider the value usable. Does not validate the
 * cryptographic signature of the access/refresh tokens.
 */
export const isValidSession = (value: unknown): value is Session =>
  typeof value === 'object' &&
  value !== null &&
  'access_token' in value &&
  'refresh_token' in value &&
  'expires_at' in value
