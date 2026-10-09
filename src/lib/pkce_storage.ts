import { getItemAsync, setItemAsync } from './storage_helpers'
import type { SupportedStorage } from './types'

export const CODE_VERIFIER_TTL_MS = 10 * 60 * 1000

type StoredCodeVerifier = {
  verifier: string
  createdAt: number
  redirectType?: string
  returnTo?: string
  /**
   * El `redirect_uri` EXACTO que se puso en la URL de `/authorize`. Se guarda
   * para repetirlo idéntico en el canje `/oauth/token` (RFC 6749 §4.1.3): el
   * server lo comparaba y, al omitirlo, el canje salía `redirect_uri_mismatch`
   * (§305). No viaja de vuelta en la URL; vive aquí.
   */
  redirectUri?: string
  /**
   * Whether the app put its own `state` in the authorize URL. Read back on
   * the callback to decide if `state` may be wiped from the address bar —
   * see `callbackParamsToClear`.
   */
  sentState?: boolean
  /**
   * Lo que la app quiso llevarse por el login. Nunca sale del navegador: no
   * viaja en la URL ni llega al servidor, igual que `returnTo`.
   */
  appState?: unknown
}

type LoadedCodeVerifier = {
  verifier: string
  redirectType?: string
  returnTo?: string
  sentState?: boolean
  appState?: unknown
  redirectUri?: string
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
    sentState,
    appState,
    redirectUri,
    now = Date.now()
  }: {
    verifier: string
    redirectType?: string
    returnTo?: string
    sentState?: boolean
    appState?: unknown
    redirectUri?: string
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
  if (redirectUri) {
    payload.redirectUri = redirectUri
  }
  if (sentState) {
    payload.sentState = true
  }
  // `undefined` no: distingue «no mandó nada» de «mandó null», y además
  // setItemAsync serializa a JSON, donde un undefined desaparece solo.
  if (appState !== undefined) {
    payload.appState = appState
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
  if (raw.sentState) {
    loaded.sentState = true
  }
  if (raw.appState !== undefined) {
    loaded.appState = raw.appState
  }
  if (raw.redirectUri) {
    loaded.redirectUri = raw.redirectUri
  }
  return loaded
}
