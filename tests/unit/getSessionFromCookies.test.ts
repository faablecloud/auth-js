import { describe, expect, it } from 'vitest'
import { getSessionFromCookies } from '../../src/lib/nextjs'

const validSession = {
  access_token: 'at_test',
  refresh_token: 'rt_test',
  expires_at: 1_700_000_000,
  expires_in: 3600,
  token_type: 'bearer',
  user: { sub: 'user_1', email: 'user@example.com' }
}

const KEY = 'faableauth.token-client'

const encoded = encodeURIComponent(JSON.stringify(validSession))

describe('getSessionFromCookies', () => {
  it('parses a session from a Next.js cookies() store', () => {
    const cookiesStore = {
      get(name: string) {
        return name === KEY ? { name, value: encoded } : undefined
      }
    }
    expect(getSessionFromCookies(cookiesStore, KEY)).toEqual(validSession)
  })

  it('parses a session from a plain object map', () => {
    const cookiesStore = { [KEY]: encoded }
    expect(getSessionFromCookies(cookiesStore, KEY)).toEqual(validSession)
  })

  it('returns null when the cookie is absent', () => {
    expect(getSessionFromCookies({ get: () => undefined }, KEY)).toBeNull()
    expect(getSessionFromCookies({}, KEY)).toBeNull()
  })

  it('returns null when the cookie value is malformed JSON', () => {
    const cookiesStore = { [KEY]: encodeURIComponent('{not-json') }
    expect(getSessionFromCookies(cookiesStore, KEY)).toBeNull()
  })
})
