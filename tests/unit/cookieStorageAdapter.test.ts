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
})
