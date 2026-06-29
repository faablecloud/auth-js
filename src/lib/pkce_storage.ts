import { getItemAsync, setItemAsync } from './storage_helpers'
import type { SupportedStorage } from './types'

export const CODE_VERIFIER_TTL_MS = 10 * 60 * 1000

type StoredCodeVerifier = {
  verifier: string
  createdAt: number
  redirectType?: string
  returnTo?: string
}

type LoadedCodeVerifier = {
  verifier: string
  redirectType?: string
  returnTo?: string
}

const isStoredCodeVerifier = (value: unknown): value is StoredCodeVerifier =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredCodeVerifier).verifier === 'string' &&
  typeof (value as StoredCodeVerifier).createdAt === 'number'

export const saveCodeVerifier = async (
  storage: SupportedStorage,
  key: string,
  {
    verifier,
    redirectType,
    returnTo,
    now = Date.now()
  }: {
    verifier: string
    redirectType?: string
    returnTo?: string
    now?: number
  }
): Promise<void> => {
  const payload: StoredCodeVerifier = { verifier, createdAt: now }
  if (redirectType) {
    payload.redirectType = redirectType
  }
  if (returnTo) {
    payload.returnTo = returnTo
  }
  await setItemAsync(storage, key, payload)
}

export const loadCodeVerifier = async (
  storage: SupportedStorage,
  key: string,
  { now = Date.now() }: { now?: number } = {}
): Promise<LoadedCodeVerifier | null> => {
  const raw = await getItemAsync(storage, key)
  if (!isStoredCodeVerifier(raw)) {
    return null
  }

  if (now - raw.createdAt > CODE_VERIFIER_TTL_MS) {
    await storage.removeItem(key)
    return null
  }

  const loaded: LoadedCodeVerifier = { verifier: raw.verifier }
  if (raw.redirectType) {
    loaded.redirectType = raw.redirectType
  }
  if (raw.returnTo) {
    loaded.returnTo = raw.returnTo
  }
  return loaded
}
