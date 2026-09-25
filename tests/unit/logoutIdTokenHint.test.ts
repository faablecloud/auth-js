import { describe, expect, it } from 'vitest'
import { createClient } from '../../src/createClient'
import { _sessionResponse } from '../../src/lib/helpers'

const auth = createClient({
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  redirectUri: 'https://app.example.com/callback'
})

// OIDC RP-Initiated Logout §2: the id_token of the session being ended rides
// along as `id_token_hint`, so the server can verify who is signing out.
describe('getLogoutUrl id_token_hint', () => {
  it('carries the hint and the return URL', () => {
    const url = new URL(
      auth.getLogoutUrl({
        returnTo: 'https://app.example.com/bye',
        idTokenHint: 'eyJ.hint.sig'
      })
    )
    expect(url.pathname).toBe('/logout')
    expect(url.searchParams.get('client_id')).toBe('test-client')
    expect(url.searchParams.get('id_token_hint')).toBe('eyJ.hint.sig')
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.example.com/bye'
    )
  })

  it('omits the hint when there is none', () => {
    const url = new URL(auth.getLogoutUrl())
    expect(url.searchParams.has('id_token_hint')).toBe(false)
  })
})

describe('the stored session keeps the id_token', () => {
  it('copies id_token from the token response', () => {
    const { data } = _sessionResponse({
      data: {
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        token_type: 'bearer',
        id_token: 'eyJ.id.tok',
        user: { id: 'user_1' } as never
      },
      error: null
    } as never)
    expect(data.session?.id_token).toBe('eyJ.id.tok')
  })
})
