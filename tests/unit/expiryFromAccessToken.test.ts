import { describe, expect, it } from 'vitest'
import { expiryFromAccessToken } from '../../src/lib/jwt'

// Minimal JWT builder: only the payload segment is read by decodeJWTPayload.
const makeJwt = (payload: Record<string, unknown>) => {
  const seg = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${seg({ alg: 'RS256', typ: 'JWT' })}.${seg(payload)}.sig`
}

describe('expiryFromAccessToken', () => {
  const NOW = 1_700_000_000 // seconds

  it("derives expiry from the access token's exp claim", () => {
    const token = makeJwt({ exp: NOW + 3600 })
    const { expiresAt, expiresIn } = expiryFromAccessToken(
      token,
      undefined,
      NOW
    )
    expect(expiresAt).toBe(NOW + 3600)
    expect(expiresIn).toBe(3600)
  })

  it('prefers an explicit expires_at over the exp claim', () => {
    const token = makeJwt({ exp: NOW + 3600 })
    const { expiresAt, expiresIn } = expiryFromAccessToken(
      token,
      String(NOW + 60),
      NOW
    )
    expect(expiresAt).toBe(NOW + 60)
    expect(expiresIn).toBe(60)
  })

  it('treats an empty-string expires_at as absent and falls back to exp', () => {
    const token = makeJwt({ exp: NOW + 1200 })
    const { expiresAt } = expiryFromAccessToken(token, '', NOW)
    expect(expiresAt).toBe(NOW + 1200)
  })

  it('falls back to now when the token carries no exp claim', () => {
    const token = makeJwt({ sub: 'user_1' })
    const { expiresAt, expiresIn } = expiryFromAccessToken(
      token,
      undefined,
      NOW
    )
    expect(expiresAt).toBe(NOW)
    expect(expiresIn).toBe(0)
  })

  it('accepts a numeric expires_at', () => {
    const token = makeJwt({ exp: NOW + 3600 })
    const { expiresAt } = expiryFromAccessToken(token, NOW + 30, NOW)
    expect(expiresAt).toBe(NOW + 30)
  })
})
