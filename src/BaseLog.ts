import { version } from './lib/version'

export type BaseLogOptions = {
  debug?: boolean | ((message: string, ...args: any[]) => void)
}

/**
 * localStorage key that turns debug logging on without touching the app's
 * code. Read when a client is constructed — which on a sign-in callback is at
 * page load, before anyone can type in a console — so it has to survive the
 * reload:
 *
 *   localStorage.setItem('faable.auth.debug', 'true'); location.reload()
 *
 * An explicit `debug` option in the config always wins over it. Same idea as
 * `faable.auth.locks.debug` (lock/locks.ts), for the whole SDK.
 */
export const DEBUG_STORAGE_KEY = 'faable.auth.debug'

const debugFlag = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY) === 'true'
  } catch {
    // Storage blocked (Safari private mode, sandboxed iframe, SSR): no flag.
    return false
  }
}

export abstract class BaseLog {
  protected logDebugMessages: boolean
  protected logger: (message: string, ...args: any[]) => void = console.log

  constructor(config: BaseLogOptions = {}) {
    this.logDebugMessages =
      config.debug === undefined ? debugFlag() : !!config.debug
    if (typeof config.debug === 'function') {
      this.logger = config.debug
    }
  }

  protected extraPrint?(): string

  protected _debug(...args: any[]) {
    if (this.logDebugMessages) {
      const extra = this.extraPrint ? this.extraPrint() : ''
      this.logger(
        `FaableAuth@${extra} (${version}) ${new Date().toISOString()}`,
        ...args
      )
    }

    return this
  }
}
