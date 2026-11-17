import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { mountChallengeWidget } from '../../src/lib/challenge_widget'
import { _get, _post } from '../../src/lib/fetch'
import {
  FormTransactions,
  TX_MIN_AGE_MS,
  TX_SAFETY_MARGIN_MS,
  __resetFormInPlay,
  takeTransaction
} from '../../src/lib/form_transaction'
import type { SupportedStorage } from '../../src/lib/types'

vi.mock('../../src/lib/fetch', () => ({
  _post: vi.fn(),
  _get: vi.fn()
}))

const mGet = _get as unknown as ReturnType<typeof vi.fn>
const mPost = _post as unknown as ReturnType<typeof vi.fn>

const DOMAIN = 'https://tenant.auth.faable.link'
const TX_URL = `${DOMAIN}/login/transaction?client_id=test-client`

let n = 0
const minted = (ttlMs = 15 * 60_000) => ({
  data: {
    tx: `tx_${++n}`,
    expires_at: new Date(Date.now() + ttlMs).toISOString()
  },
  error: null,
  status: 200
})

const notFound = {
  data: { message: 'Not Found' },
  error: 'Not Found',
  status: 404
}

const storage = (): SupportedStorage => {
  const m = new Map<string, string>()
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: k => void m.delete(k)
  }
}

const client = () =>
  createClient({
    domain: DOMAIN,
    clientId: 'test-client',
    storage: storage(),
    autoRefreshToken: false as const
  })

const txCalls = () => mGet.mock.calls.filter(([url]) => url === TX_URL)

/** Lets queued promise callbacks run under fake timers. */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  __resetFormInPlay()
  n = 0
  mGet.mockReset()
  mPost.mockReset()
  mGet.mockImplementation(async (url: string) =>
    url === TX_URL ? minted() : { data: null, error: null }
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * A document that records its focusin listeners and can play a focus on an
 * element: `field('input', true)` is an input inside a <form>.
 */
const fakeDocument = () => {
  const listeners = new Set<(ev: Event) => void>()
  return {
    listeners,
    addEventListener: (
      type: string,
      fn: (ev: Event) => void,
      capture?: boolean
    ) => {
      if (type === 'focusin' && capture) listeners.add(fn)
    },
    removeEventListener: (type: string, fn: (ev: Event) => void) => {
      if (type === 'focusin') listeners.delete(fn)
    },
    focus: (tag: string, inForm: boolean) => {
      const target = {
        matches: (sel: string) => sel.split(/,\s*/).includes(tag),
        closest: (sel: string) => (sel === 'form' && inForm ? {} : null)
      }
      Array.from(listeners).forEach(fn => fn({ target } as unknown as Event))
    }
  }
}

const browser = () => {
  const doc = fakeDocument()
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', doc)
  return doc
}

describe('form transaction: prefetch', () => {
  it('createClient does not fetch one on page load', async () => {
    const doc = browser()
    client()
    await flush()
    expect(txCalls()).toHaveLength(0)
    expect(doc.listeners.size).toBe(1)
  })

  it('fetches one on the first focus on a field inside a <form>, once', async () => {
    const doc = browser()
    const ft = new FormTransactions(DOMAIN, 'test-client')
    ft.arm()
    ft.arm()
    expect(doc.listeners.size).toBe(1)
    doc.focus('div', true)
    doc.focus('input', false)
    await flush()
    expect(txCalls()).toHaveLength(0)
    doc.focus('textarea', true)
    await flush()
    expect(txCalls()).toHaveLength(1)
    expect(doc.listeners.size).toBe(0)
    doc.focus('input', true)
    await flush()
    expect(txCalls()).toHaveLength(1)
  })

  it('one listener per client', () => {
    const doc = browser()
    new FormTransactions(DOMAIN, 'a').arm()
    new FormTransactions(DOMAIN, 'b').arm()
    expect(doc.listeners.size).toBe(2)
  })

  it('a challenge widget mounting fetches one for every armed client', async () => {
    const doc = browser()
    const ft = new FormTransactions(DOMAIN, 'test-client')
    ft.arm()
    // The hook runs before any rendering: a bare element is enough.
    const el = {
      attachShadow: () => {
        throw new Error('no DOM here')
      }
    } as unknown as Element
    expect(() => mountChallengeWidget(el)).toThrow('no DOM here')
    await flush()
    expect(txCalls()).toHaveLength(1)
    expect(doc.listeners.size).toBe(0)
  })

  it('a client created after a widget mounted fetches one at once', async () => {
    browser()
    expect(() =>
      mountChallengeWidget({
        attachShadow: () => {
          throw new Error('no DOM here')
        }
      } as unknown as Element)
    ).toThrow()
    new FormTransactions(DOMAIN, 'test-client').arm()
    await flush()
    expect(txCalls()).toHaveLength(1)
  })

  it('nothing in Node / SSR', async () => {
    expect(typeof window).toBe('undefined')
    const ft = new FormTransactions(DOMAIN, 'test-client')
    ft.arm()
    ft.prefetch()
    client()
    await flush()
    expect(txCalls()).toHaveLength(0)
  })

  it('refreshes in the background when the cached one is about to expire', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    const ft = new FormTransactions(DOMAIN, 'test-client')
    ft.prefetch()
    await flush()
    expect(txCalls()).toHaveLength(1)
    // 15 min TTL, refreshed 30 s before it.
    await vi.advanceTimersByTimeAsync(15 * 60_000 - TX_SAFETY_MARGIN_MS - 1000)
    expect(txCalls()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(txCalls()).toHaveLength(2)
  })
})

describe('form transaction: takeTransaction', () => {
  it('hands each tx out once and prefetches the next', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    const ft = new FormTransactions(DOMAIN, 'test-client')
    ft.prefetch()
    await vi.advanceTimersByTimeAsync(TX_MIN_AGE_MS)
    expect(await takeTransaction(ft)).toBe('tx_1')
    expect(txCalls()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(TX_MIN_AGE_MS)
    expect(await takeTransaction(ft)).toBe('tx_2')
  })

  it('fetches one when none is cached, and waits until it is a second old', async () => {
    vi.useFakeTimers()
    const ft = new FormTransactions(DOMAIN, 'test-client')
    let got: string | undefined
    void takeTransaction(ft).then(v => (got = v))
    await vi.advanceTimersByTimeAsync(TX_MIN_AGE_MS - 100)
    expect(got).toBeUndefined()
    await vi.advanceTimersByTimeAsync(200)
    expect(got).toBe('tx_1')
    // Node: no background prefetch after the take.
    expect(txCalls()).toHaveLength(1)
  })

  it('a 404 (server without /login/transaction) is no tx, quietly', async () => {
    const log = vi.spyOn(console, 'log')
    const warn = vi.spyOn(console, 'warn')
    const error = vi.spyOn(console, 'error')
    mGet.mockResolvedValue(notFound)
    const ft = new FormTransactions(DOMAIN, 'test-client')
    expect(await takeTransaction(ft)).toBeUndefined()
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('a network failure or a malformed body is no tx', async () => {
    const ft = new FormTransactions(DOMAIN, 'test-client')
    mGet.mockResolvedValueOnce({ data: null, error: new TypeError('fetch') })
    expect(await takeTransaction(ft)).toBeUndefined()
    mGet.mockResolvedValueOnce({ data: { tx: 42 }, error: null, status: 200 })
    expect(await takeTransaction(ft)).toBeUndefined()
    mGet.mockRejectedValueOnce(new Error('boom'))
    expect(await takeTransaction(ft)).toBeUndefined()
  })

  it('gives up after the timeout and goes without tx', async () => {
    vi.useFakeTimers()
    mGet.mockImplementation(() => new Promise(() => {}))
    const ft = new FormTransactions(DOMAIN, 'test-client')
    let done = false
    let got: string | undefined = 'unset'
    void takeTransaction(ft).then(v => {
      done = true
      got = v
    })
    await vi.advanceTimersByTimeAsync(1600)
    expect(done).toBe(true)
    expect(got).toBeUndefined()
  })

  it('does not hand out one inside the 30 s safety margin', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {})
    const ft = new FormTransactions(DOMAIN, 'test-client')
    ft.prefetch()
    await flush()
    // The expiry timer is what normally drops it; a throttled background tab
    // can fire it late, so take() must check on its own.
    vi.setSystemTime(Date.now() + 15 * 60_000 - TX_SAFETY_MARGIN_MS + 1000)
    const p = takeTransaction(ft)
    await vi.advanceTimersByTimeAsync(TX_MIN_AGE_MS)
    expect(await p).toBe('tx_2')
  })

  it('a local clock far off the server falls back to the 15 min TTL', async () => {
    vi.useFakeTimers()
    mGet.mockResolvedValueOnce(minted(-60 * 60_000))
    const ft = new FormTransactions(DOMAIN, 'test-client')
    const p = takeTransaction(ft)
    await vi.advanceTimersByTimeAsync(TX_MIN_AGE_MS)
    expect(await p).toBe('tx_1')
  })
})

describe('form transaction: signup() and signInWithPasswordless()', () => {
  const challengeRequired = {
    data: {
      error_code: 'challenge_required',
      details: {
        id: 'ch_1',
        kind: 'pow',
        seed: '0123456789abcdef0123456789abcdef',
        email_hash: 'ab'.repeat(32),
        difficulty: 1,
        expires_at: new Date(Date.now() + 300_000).toISOString()
      }
    },
    error: 'solve the challenge and retry',
    status: 428,
    code: 'challenge_required'
  }

  it('signup sends the tx, and a fresh one on the challenge retry', async () => {
    mPost.mockResolvedValueOnce(challengeRequired).mockResolvedValueOnce({
      data: { status: 'created', user_id: 'user_1' },
      error: null,
      status: 200
    })
    const { error } = await client().signup({ email: 'laura@ejemplo.com' })
    expect(error).toBeNull()
    expect(mPost).toHaveBeenCalledTimes(2)
    const [first, retry] = mPost.mock.calls.map(c => c[1])
    expect(first.tx).toBe('tx_1')
    expect(retry.tx).toBe('tx_2')
    expect(retry.challenge.id).toBe('ch_1')
  })

  it('signInWithPasswordless sends the tx, never the same one twice', async () => {
    mPost.mockResolvedValue({
      data: { email: 'laura@ejemplo.com' },
      error: null
    })
    const c = client()
    await c.signInWithPasswordless({ email: 'laura@ejemplo.com', type: 'code' })
    await c.signInWithPasswordless({ email: 'laura@ejemplo.com', type: 'code' })
    const txs = mPost.mock.calls.map(call => call[1].tx)
    expect(txs).toEqual(['tx_1', 'tx_2'])
  })

  it('without /login/transaction the request goes without tx', async () => {
    mGet.mockResolvedValue(notFound)
    mPost.mockResolvedValue({
      data: { email: 'laura@ejemplo.com' },
      error: null
    })
    const { error } = await client().signInWithPasswordless({
      email: 'laura@ejemplo.com',
      type: 'code'
    })
    expect(error).toBeNull()
    expect(mPost.mock.calls[0][1]).not.toHaveProperty('tx')
  })
})
