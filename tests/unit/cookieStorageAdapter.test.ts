import { beforeEach, describe, expect, it } from 'vitest'
import {
  CookieJar,
  cookieStorageAdapter
} from '../../src/lib/storage/cookie-storage'

/**
 * A jar that mirrors browser semantics: each assignment to `cookie` updates
 * (or removes when Max-Age=0) one entry rather than replacing the whole bag.
 */
const browserLikeJar = (initial: string = ''): CookieJar => {
  const store = new Map<string, string>()
  for (const pair of initial.split(';')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    store.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }
  return {
    get cookie() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    set cookie(assignment: string) {
      const [first, ...rest] = assignment.split(';')
      const eq = first.indexOf('=')
      if (eq < 0) return
      const name = first.slice(0, eq).trim()
      const value = first.slice(eq + 1).trim()
      const isRemoval = rest.some(part =>
        /^\s*Max-Age=0\s*$/i.test(part.trim())
      )
      if (isRemoval) store.delete(name)
      else store.set(name, value)
    }
  }
}

describe('cookieStorageAdapter', () => {
  let jar: CookieJar
  beforeEach(() => {
    jar = browserLikeJar()
  })

  it('round-trips a value through setItem/getItem', () => {
    const adapter = cookieStorageAdapter({}, jar)
    adapter.setItem('session', JSON.stringify({ a: 1 }))
    const back = adapter.getItem('session')
    expect(back).toBe(JSON.stringify({ a: 1 }))
  })

  it('preserves values containing "=" and ";" (no naïve splitting)', () => {
    const adapter = cookieStorageAdapter({}, jar)
    const payload = 'a;b=c;d=e==='
    adapter.setItem('weird', payload)
    expect(adapter.getItem('weird')).toBe(payload)
  })

  it('does not collide between cookies with shared prefixes', () => {
    const adapter = cookieStorageAdapter({}, jar)
    adapter.setItem('auth', 'one')
    adapter.setItem('auth-extra', 'two')
    expect(adapter.getItem('auth')).toBe('one')
    expect(adapter.getItem('auth-extra')).toBe('two')
  })

  it('returns null when the cookie is missing', () => {
    const adapter = cookieStorageAdapter({}, jar)
    expect(adapter.getItem('nope')).toBeNull()
  })

  it('removeItem deletes the cookie', () => {
    const adapter = cookieStorageAdapter({}, jar)
    adapter.setItem('session', 'value')
    adapter.removeItem('session')
    expect(adapter.getItem('session')).toBeNull()
  })

  it('passes through the configured attributes when writing', () => {
    const writes: string[] = []
    const recordingJar: CookieJar = {
      cookie: '',
      // override set so we can inspect the raw assignment
      // (defineProperty would also work but a wrapped object is simpler)
      ...({} as any)
    }
    Object.defineProperty(recordingJar, 'cookie', {
      get: () => '',
      set: (assignment: string) => {
        writes.push(assignment)
      }
    })

    const adapter = cookieStorageAdapter(
      {
        domain: '.example.com',
        path: '/api',
        sameSite: 'Strict',
        secure: true
      },
      recordingJar
    )
    adapter.setItem('session', 'value')

    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('Domain=.example.com')
    expect(writes[0]).toContain('Path=/api')
    expect(writes[0]).toContain('SameSite=Strict')
    expect(writes[0]).toContain('Secure')
  })

  it('removeItem mirrors attributes so the browser actually clears it', () => {
    const writes: string[] = []
    const recordingJar = {} as CookieJar
    Object.defineProperty(recordingJar, 'cookie', {
      get: () => '',
      set: (assignment: string) => {
        writes.push(assignment)
      }
    })

    const adapter = cookieStorageAdapter(
      { domain: '.example.com', path: '/api', sameSite: 'None' },
      recordingJar
    )
    adapter.removeItem('session')

    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('Max-Age=0')
    expect(writes[0]).toContain('Domain=.example.com')
    expect(writes[0]).toContain('Path=/api')
    expect(writes[0]).toContain('SameSite=None')
    expect(writes[0]).toContain('Secure')
  })

  it('no-ops when no document/jar is available (SSR path)', () => {
    const adapter = cookieStorageAdapter({}, null)
    adapter.setItem('a', 'b')
    expect(adapter.getItem('a')).toBeNull()
    adapter.removeItem('a')
  })

  describe('chunking for oversized values', () => {
    // Real-world threshold: 3200 raw bytes per chunk. Anything above must split.
    const CHUNK = 3200

    it('round-trips a value larger than one chunk via numbered cookies', () => {
      const adapter = cookieStorageAdapter({}, jar)
      const big = 'A'.repeat(CHUNK * 2 + 137) // 3 chunks (2 full + remainder)
      adapter.setItem('session', big)

      // Single key must not exist; chunked keys must.
      expect(jar.cookie).not.toMatch(/(?:^|; )session=/)
      expect(jar.cookie).toMatch(/session\.0=/)
      expect(jar.cookie).toMatch(/session\.1=/)
      expect(jar.cookie).toMatch(/session\.2=/)
      expect(adapter.getItem('session')).toBe(big)
    })

    it('keeps short values as a single cookie (no chunking overhead)', () => {
      const adapter = cookieStorageAdapter({}, jar)
      adapter.setItem('session', 'small')
      expect(jar.cookie).toMatch(/(?:^|; )session=/)
      expect(jar.cookie).not.toMatch(/session\.0=/)
    })

    it('removeItem clears every chunk', () => {
      const adapter = cookieStorageAdapter({}, jar)
      adapter.setItem('session', 'B'.repeat(CHUNK * 2))
      expect(adapter.getItem('session')).not.toBeNull()
      adapter.removeItem('session')
      expect(adapter.getItem('session')).toBeNull()
      expect(jar.cookie).not.toMatch(/session\./)
    })

    it('rewriting smaller wipes stale chunks (no leftover .N cookies)', () => {
      const adapter = cookieStorageAdapter({}, jar)
      adapter.setItem('session', 'C'.repeat(CHUNK * 3))
      adapter.setItem('session', 'now small')
      expect(adapter.getItem('session')).toBe('now small')
      expect(jar.cookie).not.toMatch(/session\.\d+=/)
    })

    it('rewriting larger wipes a stale single cookie (no leftover key)', () => {
      const adapter = cookieStorageAdapter({}, jar)
      adapter.setItem('session', 'tiny')
      const big = 'D'.repeat(CHUNK + 1)
      adapter.setItem('session', big)
      expect(adapter.getItem('session')).toBe(big)
      expect(jar.cookie).not.toMatch(/(?:^|; )session=/)
    })

    it('chunk-prefix collisions on unrelated cookies are ignored', () => {
      const adapter = cookieStorageAdapter({}, jar)
      // `session.notes` shares the prefix but is not a chunk (not /^\d+$/)
      adapter.setItem('session.notes', 'untouched')
      adapter.setItem('session', 'E'.repeat(CHUNK + 50))
      adapter.removeItem('session')
      expect(adapter.getItem('session.notes')).toBe('untouched')
    })
  })
})
