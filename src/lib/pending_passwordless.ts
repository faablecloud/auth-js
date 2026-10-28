import { getItemAsync, setItemAsync } from './storage_helpers'
import type { SupportedStorage } from './types'

/**
 * How long an emailed code stays "pending" for the screen that asks for it.
 * Longer than the code itself (5 minutes on the server): past its life the
 * screen still helps — the email is filled in and resending is one tap — but
 * not forever, because after this whoever opens the login screen is not
 * coming back for that code.
 */
export const PENDING_PASSWORDLESS_TTL_MS = 30 * 60 * 1000

/**
 * A code emailed by {@link FaableAuthClient.signInWithPasswordless} that
 * nobody has typed yet, kept so that losing the screen that asked for it does
 * not mean starting over. On a phone the code arrives in another app, and the
 * in-app browser the login was opened in is often gone when the user comes
 * back.
 *
 * The SDK clears it when the code is spent — any sign-in on this client — and
 * on sign-out: a pending code belongs to a browser that is signed out and
 * waiting. Apps that kept their own copy had to remember both, and one that
 * forgot showed "We've sent you a code" after a logout for a code already
 * used.
 *
 * @see {@link FaableAuthClient.getPendingPasswordless}
 */
export type PendingPasswordless = {
  email: string
  /** Epoch milliseconds of the send. */
  sent_at: number
  /**
   * Whatever the app passed as `appState` when it asked for the code. Never
   * leaves the browser.
   */
  appState?: unknown
}

type StoredPendingPasswordless = PendingPasswordless & {
  /** When this record was written, for the TTL. */
  createdAt: number
}

const pendingKey = (storageKey: string) => `${storageKey}-pending-passwordless`

const isStored = (value: unknown): value is StoredPendingPasswordless =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredPendingPasswordless).email === 'string' &&
  !!(value as StoredPendingPasswordless).email &&
  typeof (value as StoredPendingPasswordless).sent_at === 'number' &&
  typeof (value as StoredPendingPasswordless).createdAt === 'number'

export const savePendingPasswordless = async (
  storage: SupportedStorage,
  storageKey: string,
  { email, sent_at, appState }: PendingPasswordless,
  now = Date.now()
): Promise<void> => {
  const payload: StoredPendingPasswordless = {
    email,
    sent_at,
    createdAt: now
  }
  // Same rule as the PKCE record: `undefined` is "sent nothing", not `null`.
  if (appState !== undefined) payload.appState = appState
  await setItemAsync(storage, pendingKey(storageKey), payload)
}

export const loadPendingPasswordless = async (
  storage: SupportedStorage,
  storageKey: string,
  now = Date.now()
): Promise<PendingPasswordless | null> => {
  const raw = await getItemAsync(storage, pendingKey(storageKey))
  if (!isStored(raw)) return null
  if (now - raw.createdAt > PENDING_PASSWORDLESS_TTL_MS) {
    await storage.removeItem(pendingKey(storageKey))
    return null
  }
  const pending: PendingPasswordless = {
    email: raw.email,
    sent_at: raw.sent_at
  }
  if (raw.appState !== undefined) pending.appState = raw.appState
  return pending
}

export const clearPendingPasswordless = async (
  storage: SupportedStorage,
  storageKey: string
): Promise<void> => {
  await storage.removeItem(pendingKey(storageKey))
}
