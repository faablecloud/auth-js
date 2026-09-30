import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEBUG_STORAGE_KEY } from '../../src/BaseLog'
import { FaableAuthClient } from '../../src/FaableAuthClient'

// The flag exists for a phone on the other end of Safari's Web Inspector: the
// only thing you can do there before the callback page loads is set a
// localStorage key and reload.

const flagStorage = (value: string | null) => ({
  getItem: (k: string) => (k === DEBUG_STORAGE_KEY ? value : null),
  setItem: () => {},
  removeItem: () => {}
})

const build = (debug?: boolean) =>
  new FaableAuthClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    autoRefreshToken: false,
    ...(debug === undefined ? {} : { debug })
  })

// The client's OWN lines, not the lock's: the lock is handed `config.debug`
// untouched, so counting every `FaableAuth@` line passed even with the client
// still forcing `debug` to false.
const faableLines = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter(
    ([first, second]) =>
      String(first).startsWith('FaableAuth@') && second === '#_initialize()'
  )

let log: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('faable.auth.debug', () => {
  it('turns debug logging on when the config says nothing', async () => {
    vi.stubGlobal('localStorage', flagStorage('true'))
    build()
    await vi.waitFor(() => expect(faableLines(log).length).toBeGreaterThan(0))
  })

  it('stays quiet without the flag', async () => {
    vi.stubGlobal('localStorage', flagStorage(null))
    await build().initialize()
    expect(faableLines(log)).toEqual([])
  })

  it('an explicit debug: false in the config wins over the flag', async () => {
    vi.stubGlobal('localStorage', flagStorage('true'))
    await build(false).initialize()
    expect(faableLines(log)).toEqual([])
  })

  it('a storage that throws is no flag, not a crash', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('SecurityError')
      }
    })
    expect(() => build()).not.toThrow()
    expect(faableLines(log)).toEqual([])
  })
})
