import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOGIN_ATTEMPT_TTL_MS,
  consumeLoginAttempt,
  loadLastUsedMethod,
  saveLastUsedMethod,
  saveLoginAttempt
} from '../../src/lib/last_used_storage'
import type { CookieJar } from '../../src/lib/storage/cookie-storage'
import type { SupportedStorage } from '../../src/lib/types'

const inMemoryStorage = (): SupportedStorage => {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v)
    },
    removeItem: k => {
      store.delete(k)
    }
  }
}

/**
 * A jar that mirrors browser semantics: each assignment to `cookie` updates
 * one entry rather than replacing the whole bag.
 */
const browserLikeJar = (): CookieJar & { writes: string[] } => {
  const store = new Map<string, string>()
  const writes: string[] = []
  return {
    writes,
    get cookie() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    set cookie(assignment: string) {
      writes.push(assignment)
      const [first] = assignment.split(';')
      const eq = first.indexOf('=')
      if (eq < 0) return
      store.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim())
    }
  }
}

const KEY = 'faableauth-client123'
const NOW = 1_700_000_000_000

describe('login attempt record', () => {
  let storage: SupportedStorage
  beforeEach(() => {
    storage = inMemoryStorage()
  })

  it('round-trips method and connection fields within the TTL', async () => {
    await saveLoginAttempt(storage, KEY, {
      method: 'oauth',
      connection_id: 'connection_abc',
      now: NOW
    })

    const attempt = await consumeLoginAttempt(storage, KEY, {
      now: NOW + 60_000
    })

    expect(attempt).toEqual({
      method: 'oauth',
      connection_id: 'connection_abc'
    })
  })

  it('consuming removes the record so it can only be promoted once', async () => {
    await saveLoginAttempt(storage, KEY, { method: 'password', now: NOW })

    expect(await consumeLoginAttempt(storage, KEY, { now: NOW })).toEqual({
      method: 'password'
    })
    expect(await consumeLoginAttempt(storage, KEY, { now: NOW })).toBeNull()
  })

  it('returns null (and removes) when the attempt outlived the TTL', async () => {
    await saveLoginAttempt(storage, KEY, { method: 'oauth', now: NOW })

    const attempt = await consumeLoginAttempt(storage, KEY, {
      now: NOW + LOGIN_ATTEMPT_TTL_MS + 1
    })

    expect(attempt).toBeNull()
    expect(await storage.getItem(`${KEY}-login-attempt`)).toBeNull()
  })

  it('returns null (and removes) on a malformed record', async () => {
    await storage.setItem(
      `${KEY}-login-attempt`,
      JSON.stringify({ method: 'carrier-pigeon', createdAt: NOW })
    )

    expect(await consumeLoginAttempt(storage, KEY, { now: NOW })).toBeNull()
    expect(await storage.getItem(`${KEY}-login-attempt`)).toBeNull()
  })

  it('returns null when nothing was stored', async () => {
    expect(await consumeLoginAttempt(storage, KEY)).toBeNull()
  })
})

describe('last-used cookie record', () => {
  it('round-trips a confirmed login through the cookie jar', () => {
    const jar = browserLikeJar()
    const record = {
      method: 'oauth' as const,
      connection_id: 'connection_abc',
      at: NOW
    }

    saveLastUsedMethod(KEY, record, {}, jar)

    expect(loadLastUsedMethod(KEY, jar)).toEqual(record)
  })

  it('writes sane cookie attributes by default', () => {
    const jar = browserLikeJar()
    saveLastUsedMethod(KEY, { method: 'otp', at: NOW }, {}, jar)

    const written = jar.writes[0]
    expect(written).toContain(`${KEY}-last-used=`)
    expect(written).toContain(`Max-Age=${180 * 24 * 60 * 60}`)
    expect(written).toContain('Path=/')
    expect(written).toContain('SameSite=Lax')
    expect(written).not.toContain('Domain=')
  })

  it('honours domain and maxAge overrides', () => {
    const jar = browserLikeJar()
    saveLastUsedMethod(
      KEY,
      { method: 'otp', at: NOW },
      { domain: '.example.com', maxAge: 3600 },
      jar
    )

    const written = jar.writes[0]
    expect(written).toContain('Domain=.example.com')
    expect(written).toContain('Max-Age=3600')
  })

  it('returns null when the cookie is absent', () => {
    expect(loadLastUsedMethod(KEY, browserLikeJar())).toBeNull()
  })

  it('returns null on malformed or unexpected cookie payloads', () => {
    const jar = browserLikeJar()
    jar.cookie = `${KEY}-last-used=not-json`
    expect(loadLastUsedMethod(KEY, jar)).toBeNull()

    jar.cookie = `${KEY}-last-used=${encodeURIComponent(
      JSON.stringify({ method: 'carrier-pigeon', at: NOW })
    )}`
    expect(loadLastUsedMethod(KEY, jar)).toBeNull()
  })

  it('no-ops without a jar (server side)', () => {
    expect(() =>
      saveLastUsedMethod(KEY, { method: 'otp', at: NOW }, {}, null)
    ).not.toThrow()
    expect(loadLastUsedMethod(KEY, null)).toBeNull()
  })
})
