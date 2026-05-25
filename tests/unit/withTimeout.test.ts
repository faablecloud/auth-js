import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from '../../src/lib/with_timeout'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the inner value when the work finishes before the deadline', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1_000, 'nope')
    expect(result).toBe('ok')
  })

  it('rejects with the provided message after the deadline passes', async () => {
    const pending = new Promise<string>(() => {})
    const wrapped = withTimeout(pending, 1_000, 'timed out')

    const assertion = expect(wrapped).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(1_001)
    await assertion
  })

  it('propagates the inner rejection without waiting for the deadline', async () => {
    const inner = Promise.reject(new Error('boom'))
    await expect(withTimeout(inner, 5_000, 'timed out')).rejects.toThrow('boom')
  })
})
