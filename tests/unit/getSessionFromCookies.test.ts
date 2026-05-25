import { describe, expect, it } from 'vitest'
import { STORAGE_KEY } from '../../src/lib/constants'
import { getSessionFromCookies } from '../../src/lib/nextjs'

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
      getSessionFromCookies({ get: () => undefined }, { clientId: CLIENT_ID })
    ).toBeNull()
    expect(getSessionFromCookies({}, { clientId: CLIENT_ID })).toBeNull()
  })

  it('returns null when the cookie value is malformed JSON', () => {
    const cookiesStore = { [DEFAULT_KEY]: encodeURIComponent('{not-json') }
    expect(
      getSessionFromCookies(cookiesStore, { clientId: CLIENT_ID })
    ).toBeNull()
  })

  describe('chunked cookies', () => {
    const split = (str: string, size: number): string[] => {
      const out: string[] = []
      for (let i = 0; i < str.length; i += size)
        out.push(str.slice(i, i + size))
      return out
    }

    it('reassembles `key.0`, `key.1`, … from a Next.js cookies() store', () => {
      const chunks = split(encoded, 50)
      const store = {
        get(name: string) {
          const match = name.match(new RegExp(`^${DEFAULT_KEY}\\.(\\d+)$`))
          if (!match) return undefined
          const idx = Number(match[1])
          return idx < chunks.length ? { name, value: chunks[idx] } : undefined
        }
      }
      expect(getSessionFromCookies(store, { clientId: CLIENT_ID })).toEqual(
        validSession
      )
    })

    it('reassembles chunks from a plain object map', () => {
      const chunks = split(encoded, 50)
      const store: Record<string, string> = {}
      chunks.forEach((c, i) => {
        store[`${DEFAULT_KEY}.${i}`] = c
      })
      expect(getSessionFromCookies(store, { clientId: CLIENT_ID })).toEqual(
        validSession
      )
    })

    it('prefers a single un-chunked cookie when both shapes are present', () => {
      const store = {
        [DEFAULT_KEY]: encoded,
        [`${DEFAULT_KEY}.0`]: 'stale-garbage'
      }
      expect(getSessionFromCookies(store, { clientId: CLIENT_ID })).toEqual(
        validSession
      )
    })
  })
})
