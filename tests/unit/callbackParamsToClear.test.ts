import { describe, expect, it } from 'vitest'
import { callbackParamsToClear } from '../../src/lib/url_helpers'

// Por qué esta función existe y no es `['code','signup','state']` a secas:
// arch/auth/oauth-state-internal-key-leak.md
describe('callbackParamsToClear', () => {
  it('borra el `state` que la app no mandó — sólo lo pudo poner el servidor', () => {
    expect(callbackParamsToClear({ sentState: false })).toContain('state')
  })

  it('NO toca el `state` de la app: es suyo y lo lee al aterrizar', () => {
    // CORE mete un JSON en base64 en `state` y lo decodifica de
    // `window.location` en SIGNED_IN. Borrarlo le quita el dato.
    expect(callbackParamsToClear({ sentState: true })).not.toContain('state')
  })

  it('el `code` y el marcador de alta se van siempre', () => {
    for (const sentState of [true, false]) {
      const params = callbackParamsToClear({ sentState })
      expect(params).toContain('code')
      expect(params).toContain('signup')
    }
  })

  it('el `iss` de RFC 9207 se va siempre: lo pone el servidor en todo callback', () => {
    // 2026-10-13: admin.faable.com aterrizaba en `/?iss=https%3A%2F%2F…`.
    for (const sentState of [true, false]) {
      expect(callbackParamsToClear({ sentState })).toContain('iss')
    }
  })

  it('sin argumentos asume que la app no mandó nada', () => {
    expect(callbackParamsToClear()).toContain('state')
  })
})
