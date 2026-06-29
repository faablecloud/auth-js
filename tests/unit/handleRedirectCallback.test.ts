import { describe, expect, it } from 'vitest'
import { createClient } from '../../src/createClient'
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

const baseConfig = {
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  storage: inMemoryStorage()
}

describe('handleRedirectCallback / lastInitializeResult', () => {
  it('resolves to an InitializeResult with an `error` field', async () => {
    const auth = createClient(baseConfig)
    const result = await auth.handleRedirectCallback()
    expect(result).toHaveProperty('error')
  })

  it('is idempotent — returns the same in-flight initialize() result', async () => {
    const auth = createClient(baseConfig)
    const fromCallback = await auth.handleRedirectCallback()
    const fromInitialize = await auth.initialize()
    // Same resolved object: the constructor already started initialize() and
    // both calls await that single in-flight run.
    expect(fromInitialize).toBe(fromCallback)
  })

  it('exposes the last initialize() result via the getter', async () => {
    const auth = createClient(baseConfig)
    expect(auth.lastInitializeResult).toBeNull()
    const result = await auth.handleRedirectCallback()
    expect(auth.lastInitializeResult).toBe(result)
  })
})
