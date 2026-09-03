import { describe, expect, it } from 'vitest'
import {
  AuthMfaRequiredError,
  isAuthMfaRequiredError
} from '../../src/lib/errors'
import { _mfaChallenge } from '../../src/lib/helpers'

// The body the auth server's token endpoint answers with when a second-factor
// policy interrupts a direct grant (see api_token/flows/mfa_token.ts).
const interrupted = (extra: Record<string, unknown> = {}) => ({
  data: {
    statusCode: 403,
    error: 'mfa_required',
    error_description: 'A second factor is required.',
    mfa_token: 'tok-123',
    mfa_required_factors: ['totp'],
    ...extra
  },
  error: 'mfa_required',
  status: 403
})

describe('_mfaChallenge', () => {
  it('recognises an interrupted grant and carries what the caller needs', () => {
    const challenge = _mfaChallenge(interrupted())
    expect(isAuthMfaRequiredError(challenge)).toBe(true)
    expect(challenge?.mfa_token).toBe('tok-123')
    expect(challenge?.factors).toEqual(['totp'])
    expect(challenge?.code).toBe('mfa_required')
    expect(challenge?.status).toBe(403)
    expect(challenge?.message).toBe('A second factor is required.')
  })

  it('reports no factors when the user must enrol first', () => {
    // The server sends an empty list when the policy is `required` and the
    // user has nothing enrolled — the application must send them to the
    // hosted security page, it cannot enrol on their behalf.
    const challenge = _mfaChallenge(interrupted({ mfa_required_factors: [] }))
    expect(challenge?.factors).toEqual([])
  })

  it('is null for an ordinary failure', () => {
    expect(
      _mfaChallenge({
        data: { statusCode: 401, message: 'Invalid or expired OTP' },
        error: 'Invalid or expired OTP',
        status: 401
      })
    ).toBeNull()
  })

  it('is null for a success', () => {
    expect(
      _mfaChallenge({
        data: { access_token: 'a', refresh_token: 'r', expires_in: 60 },
        error: null,
        status: 200
      })
    ).toBeNull()
  })

  it('is null when the code matches but no token came with it', () => {
    // Without a token there is nothing to come back with, so it must not be
    // presented as a challenge the caller could answer.
    const body = interrupted()
    delete (body.data as Record<string, unknown>).mfa_token
    expect(_mfaChallenge(body)).toBeNull()
  })

  it('is a real AuthError, so unwrap() and instanceof both work', () => {
    const challenge = _mfaChallenge(interrupted())
    expect(challenge).toBeInstanceOf(AuthMfaRequiredError)
    expect(challenge).toBeInstanceOf(Error)
  })
})
