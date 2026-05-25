import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatePKCEVerifier } from '../../src/lib/helpers'

const ALLOWED_HEX = /^[0-9a-f]+$/

describe('generatePKCEVerifier', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when the Web Crypto API is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => generatePKCEVerifier()).toThrow(/crypto/i)
  })

  it('returns a verifier within RFC 7636 length bounds when crypto is present', () => {
    const verifier = generatePKCEVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(ALLOWED_HEX.test(verifier)).toBe(true)
  })

  it('produces a different verifier on each call', () => {
    expect(generatePKCEVerifier()).not.toBe(generatePKCEVerifier())
  })
})
