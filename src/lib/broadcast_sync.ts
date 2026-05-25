import { uuid } from './helpers'
import type { AuthChangeEvent, Session, Subscription } from './types'

type Listener = (
  event: AuthChangeEvent,
  session: Session | null
) => void | Promise<void>

type DebugFn = (message: string, ...args: unknown[]) => void

const hasBroadcastChannel = (): boolean =>
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel ===
    'function'

/**
 * Wraps a BroadcastChannel plus an in-process subscriber registry so the
 * auth client can fan out state changes to local subscribers and other tabs
 * in one call. Cross-tab messages are delivered to local subscribers but
 * NOT re-broadcast, to avoid echo loops.
 */
export class BroadcastSync {
  private channel: BroadcastChannel | null = null
  private subscribers = new Map<string, Subscription>()

  constructor(
    channelName: string,
    private debug: DebugFn
  ) {
    if (!hasBroadcastChannel() || !channelName) return
    try {
      this.channel = new globalThis.BroadcastChannel(channelName)
      this.channel.addEventListener('message', async event => {
        this.debug(
          'broadcast_sync: received notification from another tab',
          event
        )
        await this.dispatch(event.data.event, event.data.session, false)
      })
    } catch (err) {
      console.error(
        'Failed to create BroadcastChannel; cross-tab sync disabled',
        err
      )
    }
  }

  subscribe(callback: Listener): { subscription: Subscription } {
    const id = uuid()
    const subscription: Subscription = {
      id,
      callback,
      unsubscribe: () => {
        this.subscribers.delete(id)
      }
    }
    this.subscribers.set(id, subscription)
    return { subscription }
  }

  async notify(
    event: AuthChangeEvent,
    session: Session | null,
    broadcast = true
  ): Promise<void> {
    if (broadcast && this.channel) {
      this.channel.postMessage({ event, session })
    }
    await this.dispatch(event, session, broadcast)
  }

  private async dispatch(
    event: AuthChangeEvent,
    session: Session | null,
    _broadcast: boolean
  ): Promise<void> {
    const errors: unknown[] = []
    const tasks = Array.from(this.subscribers.values()).map(async sub => {
      try {
        await sub.callback(event, session)
      } catch (err) {
        errors.push(err)
      }
    })
    await Promise.all(tasks)
    if (errors.length > 0) {
      for (let i = 0; i < errors.length; i += 1) {
        console.error(errors[i])
      }
      throw errors[0]
    }
  }

  close(): void {
    this.subscribers.clear()
    try {
      this.channel?.close()
    } catch {
      // ignore — channel may already be closed
    }
    this.channel = null
  }
}
