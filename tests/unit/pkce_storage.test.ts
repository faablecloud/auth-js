import { beforeEach, describe, expect, it } from 'vitest'
import {
  CODE_VERIFIER_TTL_MS,
  loadCodeVerifier,
  saveCodeVerifier
} from '../../src/lib/pkce_storage'
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

const KEY = 'auth-test-code-verifier'

describe('pkce_storage', () => {
  let storage: SupportedStorage
  beforeEach(() => {
    storage = inMemoryStorage()
  })

  it('round-trips verifier and redirectType when read within TTL', async () => {
    const now = 1_700_000_000_000
    await saveCodeVerifier(storage, KEY, {
      verifier: 'abc',
      redirectType: 'PASSWORD_RECOVERY',
      now
    })

    const result = await loadCodeVerifier(storage, KEY, { now: now + 60_000 })

    expect(result).toEqual({
      verifier: 'abc',
      redirectType: 'PASSWORD_RECOVERY'
    })
  })

  it('returns null when the stored verifier is older than the TTL', async () => {
    const now = 1_700_000_000_000
    await saveCodeVerifier(storage, KEY, { verifier: 'abc', now })

    const result = await loadCodeVerifier(storage, KEY, {
      now: now + CODE_VERIFIER_TTL_MS + 1
    })

    expect(result).toBeNull()
  })

  it('returns null when nothing is stored', async () => {
    const result = await loadCodeVerifier(storage, KEY, { now: Date.now() })
    expect(result).toBeNull()
  })

  it('returns null when the stored value is corrupted', async () => {
    await storage.setItem(KEY, 'not-json-not-an-object')
    const result = await loadCodeVerifier(storage, KEY, { now: Date.now() })
    expect(result).toBeNull()
  })

  it('omits redirectType when none was provided', async () => {
    const now = 1_700_000_000_000
    await saveCodeVerifier(storage, KEY, { verifier: 'abc', now })
    const result = await loadCodeVerifier(storage, KEY, { now })
    expect(result).toEqual({ verifier: 'abc' })
  })

  it('round-trips returnTo when read within TTL', async () => {
    const now = 1_700_000_000_000
    await saveCodeVerifier(storage, KEY, {
      verifier: 'abc',
      returnTo: '/dashboard',
      now
    })

    const result = await loadCodeVerifier(storage, KEY, { now: now + 60_000 })

    expect(result).toEqual({ verifier: 'abc', returnTo: '/dashboard' })
  })

  it('round-trips redirectType and returnTo together', async () => {
    const now = 1_700_000_000_000
    await saveCodeVerifier(storage, KEY, {
      verifier: 'abc',
      redirectType: 'PASSWORD_RECOVERY',
      returnTo: '/settings',
      now
    })

    const result = await loadCodeVerifier(storage, KEY, { now })

    expect(result).toEqual({
      verifier: 'abc',
      redirectType: 'PASSWORD_RECOVERY',
      returnTo: '/settings'
    })
  })

  it('omits returnTo when none was provided', async () => {
    const now = 1_700_000_000_000
    await saveCodeVerifier(storage, KEY, { verifier: 'abc', now })
    const result = await loadCodeVerifier(storage, KEY, { now })
    expect(result).not.toHaveProperty('returnTo')
  })
})
