import { getItemAsync, setItemAsync } from './storage_helpers'
import type { SupportedStorage } from './types'

export const CODE_VERIFIER_TTL_MS = 10 * 60 * 1000

type StoredCodeVerifier = {
  verifier: string
  createdAt: number
  redirectType?: string
}

type LoadedCodeVerifier = {
  verifier: string
  redirectType?: string
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
    now = Date.now()
  }: {
    verifier: string
    redirectType?: string
    now?: number
  }
): Promise<void> => {
  const payload: StoredCodeVerifier = { verifier, createdAt: now }
  if (redirectType) {
    payload.redirectType = redirectType
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

  return raw.redirectType
    ? { verifier: raw.verifier, redirectType: raw.redirectType }
    : { verifier: raw.verifier }
}
