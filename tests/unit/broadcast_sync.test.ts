import { describe, expect, it, vi } from 'vitest'
import { BroadcastSync } from '../../src/lib/broadcast_sync'
import type { Session } from '../../src/lib/types'

const noopDebug = () => {}

const fakeSession = { access_token: 'a' } as unknown as Session

describe('BroadcastSync', () => {
  it('invokes a subscriber with the dispatched event and session', async () => {
    const sync = new BroadcastSync('bs-test-1', noopDebug)
    const callback = vi.fn()
    sync.subscribe(callback)

    await sync.notify('SIGNED_IN', fakeSession)

    expect(callback).toHaveBeenCalledWith('SIGNED_IN', fakeSession)
    sync.close()
  })

  it('stops calling a callback after unsubscribe', async () => {
    const sync = new BroadcastSync('bs-test-2', noopDebug)
    const callback = vi.fn()
    const { subscription } = sync.subscribe(callback)
    subscription.unsubscribe()

    await sync.notify('SIGNED_OUT', null)

    expect(callback).not.toHaveBeenCalled()
    sync.close()
  })

  it('propagates events between channels with the same name', async () => {
    const a = new BroadcastSync('bs-shared', noopDebug)
    const b = new BroadcastSync('bs-shared', noopDebug)

    const received: Array<{ event: string; hasSession: boolean }> = []
    b.subscribe((event, session) => {
      received.push({ event, hasSession: !!session })
    })

    await a.notify('TOKEN_REFRESHED', fakeSession)
    await new Promise(r => setTimeout(r, 0))

    expect(received).toEqual([{ event: 'TOKEN_REFRESHED', hasSession: true }])
    a.close()
    b.close()
  })

  it('does not re-broadcast events delivered from other tabs', async () => {
    const a = new BroadcastSync('bs-noecho', noopDebug)
    const b = new BroadcastSync('bs-noecho', noopDebug)
    const c = new BroadcastSync('bs-noecho', noopDebug)

    const aSpy = vi.fn()
    a.subscribe(aSpy)

    await b.notify('SIGNED_IN', fakeSession)
    await new Promise(r => setTimeout(r, 0))
    expect(aSpy).toHaveBeenCalledTimes(1)

    aSpy.mockClear()
    await new Promise(r => setTimeout(r, 10))
    expect(aSpy).not.toHaveBeenCalled()

    a.close()
    b.close()
    c.close()
  })

  it('rethrows the first callback error after invoking the rest', async () => {
    const sync = new BroadcastSync('bs-errors', noopDebug)
    const good = vi.fn()
    sync.subscribe(() => {
      throw new Error('boom')
    })
    sync.subscribe(good)

    await expect(sync.notify('SIGNED_IN', fakeSession)).rejects.toThrow('boom')
    expect(good).toHaveBeenCalled()
    sync.close()
  })
})
