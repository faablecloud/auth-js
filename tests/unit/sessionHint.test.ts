import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { STORAGE_KEY } from '../../src/lib/constants'
import {
  clearSessionHint,
  hasSessionHint,
  saveSessionHint
} from '../../src/lib/session_hint'
import type { CookieJar } from '../../src/lib/storage/cookie-storage'
import type { SupportedStorage } from '../../src/lib/types'

// The session hint cookie: `1` while the client holds a session, gone when it
// loses it, readable from sibling subdomains with `hasSessionHint()`. It is
// what lets a marketing site show "Dashboard" in Safari, where a framed page
// cannot read the app's localStorage.

/** Browser semantics: each assignment updates one cookie, Max-Age=0 deletes it. */
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
      const name = first.slice(0, eq).trim()
      if (/Max-Age=0(;|$)/.test(assignment)) store.delete(name)
      else store.set(name, first.slice(eq + 1).trim())
    }
  }
}

const h = vi.hoisted(() => ({
  jar: null as unknown as CookieJar & { writes: string[] },
  fakeWindow: {
    location: {
      href: 'https://app.example.com/',
      origin: 'https://app.example.com',
      protocol: 'https:'
    },
    history: { state: null, replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {}
  }
}))

const net = vi.hoisted(() => ({
  impl: async (_url: string, _init: any): Promise<any> => ({
    ok: true,
    status: 200,
    json: async () => ({})
  })
}))

vi.mock('../../src/lib/globals', () => ({
  window: h.fakeWindow,
  get document() {
    return h.jar
  },
  fetch: (url: string, init: any) => net.impl(url, init)
}))

const CLIENT_ID = 'client123'
const KEY = `${STORAGE_KEY}-${CLIENT_ID}`
const HINT = `${KEY}-session-hint`

const memoryStorage = () => {
  const store = new Map<string, string>()
  const storage: SupportedStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: k => void store.delete(k)
  }
  return storage
}

const b64url = (o: object) =>
  Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (exp: number) =>
  `${b64url({ alg: 'none' })}.${b64url({ sub: 'user_1', exp })}.sig`

beforeEach(() => {
  h.jar = browserLikeJar()
  net.impl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sub: 'user_1' })
  })
})

describe('session hint helpers', () => {
  it('writes 1 with the domain, Lax, Secure on https and a 30-day max-age', () => {
    saveSessionHint(KEY, { domain: '.example.com' })
    expect(h.jar.writes[0]).toBe(
      `${encodeURIComponent(HINT)}=1; Max-Age=2592000; Domain=.example.com; Path=/; SameSite=Lax; Secure`
    )
  })

  it('clears with the same Domain and Path it was written with', () => {
    saveSessionHint(KEY, { domain: '.example.com' })
    clearSessionHint(KEY, { domain: '.example.com' })
    expect(h.jar.writes[1]).toContain('Max-Age=0; Domain=.example.com; Path=/')
    expect(hasSessionHint()).toBe(false)
  })

  it('answers for any client, or for the one asked about', () => {
    expect(hasSessionHint()).toBe(false)
    saveSessionHint(KEY, {})
    expect(hasSessionHint()).toBe(true)
    expect(hasSessionHint({ clientId: CLIENT_ID })).toBe(true)
    expect(hasSessionHint({ clientId: 'other' })).toBe(false)
  })

  it('ignores unrelated cookies and a value other than 1', () => {
    h.jar.cookie = `${KEY}-last-used=x; Path=/`
    h.jar.cookie = `${HINT}=0; Path=/`
    expect(hasSessionHint()).toBe(false)
  })
})

describe('client with sessionHintCookie', () => {
  const client = (storage: SupportedStorage, enabled = true) =>
    createClient({
      domain: 'https://tenant.auth.faable.link',
      clientId: CLIENT_ID,
      storage,
      autoRefreshToken: false,
      ...(enabled ? { sessionHintCookie: { domain: '.example.com' } } : {})
    })

  it('sets the hint when a session is saved and clears it on sign-out', async () => {
    const auth = client(memoryStorage())
    const exp = Math.floor(Date.now() / 1000) + 3600
    const { error } = await auth.setSession({
      access_token: jwt(exp),
      refresh_token: 'rt_1'
    })
    expect(error).toBeNull()
    expect(hasSessionHint({ clientId: CLIENT_ID })).toBe(true)

    await auth.signOut({ scope: 'local' })
    expect(hasSessionHint()).toBe(false)
  })

  it('writes nothing unless enabled', async () => {
    const auth = client(memoryStorage(), false)
    const exp = Math.floor(Date.now() / 1000) + 3600
    await auth.setSession({ access_token: jwt(exp), refresh_token: 'rt_1' })
    expect(h.jar.writes.filter(w => w.includes('session-hint'))).toEqual([])
  })
})
