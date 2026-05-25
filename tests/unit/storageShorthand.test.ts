import { describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { localStorageAdapter } from '../../src/lib/storage/local-storage'

const baseConfig = {
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client'
}

describe('storage shorthand', () => {
  it('defaults to the bundled localStorage adapter when storage is omitted', () => {
    const auth = createClient(baseConfig)
    expect(auth['storage']).toBe(localStorageAdapter)
  })

  it("storage: 'localStorage' also resolves to the bundled localStorage adapter", () => {
    const auth = createClient({ ...baseConfig, storage: 'localStorage' })
    expect(auth['storage']).toBe(localStorageAdapter)
  })

  it("storage: 'cookie' switches to the cookie adapter", () => {
    const auth = createClient({ ...baseConfig, storage: 'cookie' })
    expect(auth['storage']).not.toBe(localStorageAdapter)
    expect(typeof auth['storage'].setItem).toBe('function')
  })

  it('passing cookieOptions implicitly enables cookie storage', () => {
    const auth = createClient({
      ...baseConfig,
      cookieOptions: { domain: '.example.com' }
    })
    expect(auth['storage']).not.toBe(localStorageAdapter)
  })

  it('accepts a custom SupportedStorage object verbatim', async () => {
    const store = new Map<string, string>()
    const custom = {
      getItem: vi.fn((k: string) => store.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
      removeItem: vi.fn((k: string) => void store.delete(k))
    }

    const auth = createClient({ ...baseConfig, storage: custom })
    expect(auth['storage']).toBe(custom)
    await auth['storage'].setItem('k', 'v')
    expect(custom.setItem).toHaveBeenCalledWith('k', 'v')
  })
})
