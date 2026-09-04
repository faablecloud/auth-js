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
    const result = await withTimeout(
      Promise.resolve('ok'),
      1_000,
      () => new Error('nope')
    )
    expect(result).toBe('ok')
  })

  it('rejects with the provided message after the deadline passes', async () => {
    const pending = new Promise<string>(() => {})
    const wrapped = withTimeout(pending, 1_000, () => new Error('timed out'))

    const assertion = expect(wrapped).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(1_001)
    await assertion
  })

  // The class is the point: the one caller decides how a timeout is handled by
  // what it throws, so the helper must not flatten it to a plain Error.
  it("rejects with the caller's error CLASS, not a generic Error", async () => {
    class Custom extends Error {}
    const pending = new Promise<string>(() => {})
    const wrapped = withTimeout(pending, 1_000, () => new Custom('mine'))

    const assertion = expect(wrapped).rejects.toBeInstanceOf(Custom)
    await vi.advanceTimersByTimeAsync(1_001)
    await assertion
  })

  it('does not build the error unless the deadline is reached', async () => {
    const onTimeout = vi.fn(() => new Error('unused'))
    await withTimeout(Promise.resolve('ok'), 1_000, onTimeout)
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('propagates the inner rejection without waiting for the deadline', async () => {
    const inner = Promise.reject(new Error('boom'))
    await expect(
      withTimeout(inner, 5_000, () => new Error('timed out'))
    ).rejects.toThrow('boom')
  })
})
