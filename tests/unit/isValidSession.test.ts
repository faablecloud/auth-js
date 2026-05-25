import { describe, expect, it } from 'vitest'
import { isValidSession } from '../../src/lib/session_helpers'

const validShape = {
  access_token: 'a',
  refresh_token: 'r',
  expires_at: 1700000000
}

describe('isValidSession', () => {
  it('accepts a properly shaped session object', () => {
    expect(isValidSession(validShape)).toBe(true)
  })

  it('rejects null and undefined', () => {
    expect(isValidSession(null)).toBe(false)
    expect(isValidSession(undefined)).toBe(false)
  })

  it('rejects primitives', () => {
    expect(isValidSession('string')).toBe(false)
    expect(isValidSession(42)).toBe(false)
  })

  it.each([['access_token'], ['refresh_token'], ['expires_at']])(
    'rejects a session missing %s',
    field => {
      const { [field as keyof typeof validShape]: _, ...incomplete } =
        validShape
      expect(isValidSession(incomplete)).toBe(false)
    }
  )
})
