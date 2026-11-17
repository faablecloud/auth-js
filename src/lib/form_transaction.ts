/**
 * Form transaction token for signups and passwordless codes.
 *
 * Faable Auth mints a short-lived, single-use token when the form loads
 * (`GET /login/transaction?client_id=…` → `{ tx, expires_at }`, bound to the
 * IP, the User-Agent and the client) and expects it back in the body of
 * `/dbconnections/signup` and `/passwordless/start`. A request without one
 * (from auth-js >= 3.6.0), with a reused or foreign one, or with one used less
 * than a second after it was minted, is a bot signal — not a rejection.
 *
 * The contract is the server's (auth `/login/transaction`): change one, change
 * both.
 *
 * In a browser the client fetches one in the background once a form is in
 * play — the first focus on a field inside a `<form>`, or a challenge widget
 * mounting — so by the time someone has typed an email it is ready, and a page
 * that never shows a form (a logged-in dashboard) never asks for one. Each
 * request takes the cached one (single use) and the next is prefetched right
 * away.
 * Without a cached one — SSR, Node, a prefetch that failed — the request waits
 * for a fresh one, briefly and best effort: a server that does not know
 * `/login/transaction` yet (404) or does not answer in time just means the
 * request goes without `tx`.
 */
import { _get } from './fetch'
import { withTimeout } from './with_timeout'

/** Used this long before `expires_at` at the latest: the request has to land. */
export const TX_SAFETY_MARGIN_MS = 30_000
/** How long a request waits for a tx when none is cached. */
export const TX_FETCH_TIMEOUT_MS = 1_500
/**
 * Minimum age of a tx when it is handed out. The server reads `< 1 s` as
 * `tx-too-fast`, which a person never does but a fallback fetch (or the retry
 * after a quick challenge) would. Measured from when the response ARRIVED,
 * which is after the server minted it, so the real age is always larger.
 */
export const TX_MIN_AGE_MS = 1_100
/** The server's TTL; used when the local clock makes `expires_at` absurd. */
export const TX_DEFAULT_TTL_MS = 15 * 60_000
/**
 * Background refreshes in a row without the tx being used. An idle tab would
 * otherwise mint one every ~15 minutes for as long as it stays open; after
 * this many (~2 h) the cache goes lazy and the next request fetches its own.
 */
export const TX_MAX_IDLE_REFRESHES = 8

type Cached = { tx: string; receivedAt: number; expiresAt: number }

const inBrowser = () => typeof window !== 'undefined'

/** Clients waiting for a form to be in play (see {@link armTransaction}). */
const ARMED = new Set<FormTransactions>()
/** A widget already mounted: clients armed after it prefetch at once. */
let formSeen = false

const FIELD = 'input, textarea, select'

/**
 * A form is in play: every armed client prefetches its tx. Called when a
 * challenge widget mounts (lib/challenge_widget.ts). Browser only.
 */
export const formInPlay = (): void => {
  if (!inBrowser()) return
  formSeen = true
  Array.from(ARMED).forEach(ft => ft.prefetch())
}

/** Forgets armed clients and any widget seen. For the tests. @hidden */
export const __resetFormInPlay = (): void => {
  ARMED.clear()
  formSeen = false
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Local expiry from the server's `expires_at`. A local clock that disagrees
 * with the server by minutes would otherwise make every tx look expired (and
 * refresh in a loop) or live forever: when the lifetime it implies is not
 * plausible, the server's TTL is assumed instead.
 */
const localExpiry = (expires_at: unknown, now: number): number => {
  const parsed =
    typeof expires_at === 'string' ? Date.parse(expires_at) : Number.NaN
  let lifetime = parsed - now
  if (
    !Number.isFinite(lifetime) ||
    lifetime <= 2 * TX_SAFETY_MARGIN_MS ||
    lifetime > TX_DEFAULT_TTL_MS
  ) {
    lifetime = TX_DEFAULT_TTL_MS
  }
  return now + lifetime
}

export class FormTransactions {
  private cached?: Cached
  private inflight?: Promise<void>
  private timer?: ReturnType<typeof setTimeout>
  private idleRefreshes = 0
  private armed = false
  private onFocusIn?: (ev: Event) => void

  constructor(
    private readonly domainUrl: string,
    private readonly clientId: string,
    private readonly debug: (...args: unknown[]) => void = () => {}
  ) {}

  /**
   * Waits for a form to be in play to prefetch: the first `focusin` on a field
   * inside a `<form>` (one capture listener on `document`, removed once it
   * fires) or a challenge widget mounting. Browser only; once per client.
   */
  arm(): void {
    if (!inBrowser() || this.armed) return
    this.armed = true
    ARMED.add(this)
    if (formSeen) {
      this.prefetch()
      return
    }
    const doc = typeof document !== 'undefined' ? document : undefined
    if (!doc?.addEventListener) return
    this.onFocusIn = (ev: Event) => {
      const t = ev.target as Element | null
      if (!t?.matches?.(FIELD) || !t.closest?.('form')) return
      this.prefetch()
    }
    doc.addEventListener('focusin', this.onFocusIn, true)
  }

  /** Starts fetching one in the background, in a browser only. Never throws. */
  prefetch(): void {
    if (!inBrowser()) return
    this.disarm()
    if (this.usable(this.cached)) return
    void this.refill()
  }

  /**
   * The tx for one request, or `undefined` when there is none to be had.
   * Never throws. The tx is handed out once: the next call gets another.
   */
  async take(): Promise<string | undefined> {
    let c = this.claim()
    if (!c) {
      try {
        await withTimeout(
          this.refill(),
          TX_FETCH_TIMEOUT_MS,
          () => new Error('form transaction timeout')
        )
      } catch {
        this.debug('#formTransaction', 'timed out, sending without tx')
      }
      c = this.claim()
    }
    this.idleRefreshes = 0
    // The next one, for the retry after a challenge or the next submit.
    this.prefetch()
    if (!c) return undefined
    const age = Date.now() - c.receivedAt
    if (age < TX_MIN_AGE_MS) await sleep(TX_MIN_AGE_MS - age)
    return c.tx
  }

  private disarm() {
    ARMED.delete(this)
    if (this.onFocusIn && typeof document !== 'undefined') {
      document.removeEventListener('focusin', this.onFocusIn, true)
    }
    this.onFocusIn = undefined
  }

  private usable(c?: Cached): c is Cached {
    return !!c && Date.now() < c.expiresAt - TX_SAFETY_MARGIN_MS
  }

  /** Removes the cached tx and returns it, if it can still be used. */
  private claim(): Cached | undefined {
    const c = this.cached
    this.cached = undefined
    this.clearTimer()
    return this.usable(c) ? c : undefined
  }

  /** Fetches one tx into the cache. Shared while in flight; never rejects. */
  private refill(): Promise<void> {
    if (this.inflight) return this.inflight
    const url = `${this.domainUrl}/login/transaction?client_id=${encodeURIComponent(this.clientId)}`
    const p = _get<{ tx?: unknown; expires_at?: unknown }>(url)
      .then(res => {
        const tx = res?.data?.tx
        if (
          res?.error ||
          res?.status !== 200 ||
          typeof tx !== 'string' ||
          !tx
        ) {
          this.debug(
            '#formTransaction',
            'none available',
            res?.status ?? res?.error
          )
          return
        }
        const now = Date.now()
        this.store({
          tx,
          receivedAt: now,
          expiresAt: localExpiry(res.data?.expires_at, now)
        })
      })
      .catch(e => {
        this.debug('#formTransaction', 'fetch failed', e)
      })
      .finally(() => {
        this.inflight = undefined
      })
    this.inflight = p
    return p
  }

  private store(c: Cached) {
    this.cached = c
    this.clearTimer()
    if (!inBrowser()) return
    // When it expires, drop it and fetch the next, so the cache never hands
    // out a stale one and the next submit does not have to wait.
    const delay = Math.max(0, c.expiresAt - TX_SAFETY_MARGIN_MS - Date.now())
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.cached !== c) return
      this.cached = undefined
      if (this.idleRefreshes >= TX_MAX_IDLE_REFRESHES) {
        this.debug('#formTransaction', 'idle, refreshing lazily from now on')
        return
      }
      this.idleRefreshes += 1
      void this.refill()
    }, delay)
  }

  private clearTimer() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }
}

/** See {@link FormTransactions.arm}. */
export const armTransaction = (ft: FormTransactions): void => ft.arm()

/** See {@link FormTransactions.prefetch}. */
export const prefetchTransaction = (ft: FormTransactions): void => ft.prefetch()

/** See {@link FormTransactions.take}. */
export const takeTransaction = (
  ft: FormTransactions
): Promise<string | undefined> => ft.take()
