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
  it('parses a session from a Next.js cookies() store using clientId', async () => {
    const cookiesStore = {
      get(name: string) {
        return name === DEFAULT_KEY ? { name, value: encoded } : undefined
      }
    }
    expect(
      await getSessionFromCookies(cookiesStore, { clientId: CLIENT_ID })
    ).toEqual(validSession)
  })

  it('parses a session from a plain object map using clientId', async () => {
    const cookiesStore = { [DEFAULT_KEY]: encoded }
    expect(
      await getSessionFromCookies(cookiesStore, { clientId: CLIENT_ID })
    ).toEqual(validSession)
  })

  it('honours a custom storageKey override', async () => {
    const customKey = `mi-prefix-${CLIENT_ID}`
    const cookiesStore = { [customKey]: encoded }
    expect(
      await getSessionFromCookies(cookiesStore, {
        clientId: CLIENT_ID,
        storageKey: 'mi-prefix'
      })
    ).toEqual(validSession)
  })

  it('returns null when the cookie is absent', async () => {
    expect(
      await getSessionFromCookies(
        { get: () => undefined },
        {
          clientId: CLIENT_ID
        }
      )
    ).toBeNull()
    expect(await getSessionFromCookies({}, { clientId: CLIENT_ID })).toBeNull()
  })

  it('returns null when the cookie value is malformed JSON', async () => {
    const cookiesStore = { [DEFAULT_KEY]: encodeURIComponent('{not-json') }
    expect(
      await getSessionFromCookies(cookiesStore, { clientId: CLIENT_ID })
    ).toBeNull()
  })

  // Next.js 15 made `cookies()` async — callers may pass the un-awaited
  // Promise. Before this was async-aware the duck-typing missed `.get` on the
  // Promise and returned null silently.
  describe('Next.js 15 async cookies()', () => {
    it('awaits a Promise-wrapped cookies() store', async () => {
      const cookiesStore = {
        get(name: string) {
          return name === DEFAULT_KEY ? { name, value: encoded } : undefined
        }
      }
      expect(
        await getSessionFromCookies(Promise.resolve(cookiesStore), {
          clientId: CLIENT_ID
        })
      ).toEqual(validSession)
    })

    it('awaits a Promise-wrapped plain object map', async () => {
      const store = { [DEFAULT_KEY]: encoded }
      expect(
        await getSessionFromCookies(Promise.resolve(store), {
          clientId: CLIENT_ID
        })
      ).toEqual(validSession)
    })

    it('returns null for a Promise resolving to no session', async () => {
      expect(
        await getSessionFromCookies(Promise.resolve({}), {
          clientId: CLIENT_ID
        })
      ).toBeNull()
    })

    // Backward compatibility: a non-thenable store must still return
    // synchronously so existing Next.js ≤14 callers that don't `await` keep
    // working (a Promise here would be truthy and silently "always logged in").
    it('stays synchronous for a non-Promise store', () => {
      const store = { [DEFAULT_KEY]: encoded }
      const result = getSessionFromCookies(store, { clientId: CLIENT_ID })
      expect(result).not.toBeInstanceOf(Promise)
      expect(result).toEqual(validSession)
    })
  })

  describe('chunked cookies', () => {
    const split = (str: string, size: number): string[] => {
      const out: string[] = []
      for (let i = 0; i < str.length; i += size)
        out.push(str.slice(i, i + size))
      return out
    }

    it('reassembles `key.0`, `key.1`, … from a Next.js cookies() store', async () => {
      const chunks = split(encoded, 50)
      const store = {
        get(name: string) {
          const match = name.match(new RegExp(`^${DEFAULT_KEY}\\.(\\d+)$`))
          if (!match) return undefined
          const idx = Number(match[1])
          return idx < chunks.length ? { name, value: chunks[idx] } : undefined
        }
      }
      expect(
        await getSessionFromCookies(store, { clientId: CLIENT_ID })
      ).toEqual(validSession)
    })

    it('reassembles chunks from a plain object map', async () => {
      const chunks = split(encoded, 50)
      const store: Record<string, string> = {}
      chunks.forEach((c, i) => {
        store[`${DEFAULT_KEY}.${i}`] = c
      })
      expect(
        await getSessionFromCookies(store, { clientId: CLIENT_ID })
      ).toEqual(validSession)
    })

    it('prefers a single un-chunked cookie when both shapes are present', async () => {
      const store = {
        [DEFAULT_KEY]: encoded,
        [`${DEFAULT_KEY}.0`]: 'stale-garbage'
      }
      expect(
        await getSessionFromCookies(store, { clientId: CLIENT_ID })
      ).toEqual(validSession)
    })
  })
})
