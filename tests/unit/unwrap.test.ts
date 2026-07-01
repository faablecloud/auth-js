import { describe, expect, it } from 'vitest'
import { AuthError } from '../../src/lib/errors'
import { unwrap } from '../../src/lib/unwrap'

describe('unwrap', () => {
  it('returns data when error is null', () => {
    const session = { access_token: 'a' }
    expect(unwrap({ data: { session }, error: null })).toEqual({ session })
  })

  it('returns data even when it is null on a successful result', () => {
    expect(unwrap({ data: null, error: null })).toBeNull()
  })

  it('throws the AuthError when error is present', () => {
    const error = new AuthError('bad otp', 400, 'invalid_otp')
    expect(() => unwrap({ data: null, error })).toThrow(error)
  })

  it('preserves the original error instance so callers can inspect it', () => {
    const error = new AuthError('bad otp', 400, 'invalid_otp')
    try {
      unwrap({ data: null, error })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBe(error)
      expect((e as AuthError).status).toBe(400)
    }
  })
})
