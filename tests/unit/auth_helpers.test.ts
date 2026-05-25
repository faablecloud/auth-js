import { describe, expect, it } from 'vitest'
import { resolveResponseType } from '../../src/lib/auth_helpers'

describe('resolveResponseType', () => {
  it("returns 'code' in a browser when caller does not override", () => {
    expect(resolveResponseType({}, true)).toBe('code')
  })

  it("returns 'token' outside a browser when caller does not override", () => {
    expect(resolveResponseType({}, false)).toBe('token')
  })

  it('respects caller override in a browser', () => {
    expect(resolveResponseType({ response_type: 'token' }, true)).toBe('token')
  })

  it('respects caller override outside a browser', () => {
    expect(resolveResponseType({ response_type: 'code' }, false)).toBe('code')
  })
})
