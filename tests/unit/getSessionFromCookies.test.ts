import { describe, expect, it } from 'vitest'
import { getSessionFromCookies } from '../../src/lib/nextjs'
import { STORAGE_KEY } from '../../src/lib/constants'

const validSession = {
  access_token: 'at_test',
  refresh_token: 'rt_test',
  expires_at: 1_700_000_000,
  expires_in: 3600,
  token_type: 'bearer',
  user: { sub: 'user_1', email: 'user@example.com' }
}

const CLIENT_ID = 'client'
const DEFAULT_KEY = `${STORAGE_KEY}-${CLIENT_ID}`

const encoded = encodeURIComponent(JSON.stringify(validSession))

describe('getSessionFromCookies', () => {
  it('parses a session from a Next.js cookies() store using clientId', () => {
    const cookiesStore = {
      get(name: string) {
        return name === DEFAULT_KEY ? { name, value: encoded } : undefined
      }
    }
    expect(
      getSessionFromCookies(cookiesStore, { clientId: CLIENT_ID })
    ).toEqual(validSession)
  })

  it('parses a session from a plain object map using clientId', () => {
    const cookiesStore = { [DEFAULT_KEY]: encoded }
    expect(
      getSessionFromCookies(cookiesStore, { clientId: CLIENT_ID })
    ).toEqual(validSession)
  })

  it('honours a custom storageKey override', () => {
    const customKey = `mi-prefix-${CLIENT_ID}`
    const cookiesStore = { [customKey]: encoded }
    expect(
      getSessionFromCookies(cookiesStore, {
        clientId: CLIENT_ID,
        storageKey: 'mi-prefix'
      })
    ).toEqual(validSession)
  })

  it('returns null when the cookie is absent', () => {
    expect(
      getSessionFromCookies(
        { get: () => undefined },
        { clientId: CLIENT_ID }
      )
    ).toBeNull()
    expect(getSessionFromCookies({}, { clientId: CLIENT_ID })).toBeNull()
  })

  it('returns null when the cookie value is malformed JSON', () => {
    const cookiesStore = { [DEFAULT_KEY]: encodeURIComponent('{not-json') }
    expect(
      getSessionFromCookies(cookiesStore, { clientId: CLIENT_ID })
    ).toBeNull()
  })
})
