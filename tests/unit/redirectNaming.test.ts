import { describe, expect, it } from 'vitest'
import { createClient } from '../../src/createClient'

const baseConfig = {
  domain: 'https://tenant.auth.faable.link',
  clientId: 'test-client',
  redirectUri: 'https://app.example.com/callback'
}

describe('redirect param naming', () => {
  it('uses redirectUri from config when building authorize URL', () => {
    const auth = createClient(baseConfig)
    const url = auth.buildAuthorizeUrl()
    const params = new URL(url).searchParams

    expect(params.get('client_id')).toBe('test-client')
    expect(params.get('redirect_uri')).toBe('https://app.example.com/callback')
  })

  it('redirectTo override takes precedence over redirectUri config', () => {
    const auth = createClient(baseConfig)
    const url = auth.buildAuthorizeUrl({
      redirectTo: 'https://app.example.com/other'
    })
    const params = new URL(url).searchParams

    expect(params.get('redirect_uri')).toBe('https://app.example.com/other')
  })

  it('merges queryParams (e.g. prompt) into the authorize URL', () => {
    const auth = createClient(baseConfig)
    const url = auth.buildAuthorizeUrl({
      queryParams: { prompt: 'select_account' }
    })
    const params = new URL(url).searchParams

    expect(params.get('prompt')).toBe('select_account')
    // reserved params still win over queryParams
    expect(params.get('client_id')).toBe('test-client')
  })
})

describe('getLogoutUrl', () => {
  it('builds the /logout URL with the client_id', () => {
    const auth = createClient(baseConfig)
    const url = new URL(auth.getLogoutUrl())

    expect(url.origin + url.pathname).toBe(
      'https://tenant.auth.faable.link/logout'
    )
    expect(url.searchParams.get('client_id')).toBe('test-client')
    expect(url.searchParams.has('post_logout_redirect_uri')).toBe(false)
  })

  it('maps returnTo to post_logout_redirect_uri', () => {
    const auth = createClient(baseConfig)
    const url = new URL(
      auth.getLogoutUrl({ returnTo: 'https://app.example.com/bye' })
    )

    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.example.com/bye'
    )
  })
})

describe('OAuth connection params', () => {
  it('emits connection_id when provided', async () => {
    const auth = createClient(baseConfig)
    const { data } = await auth.signInWithOauthConnection({
      connection_id: 'conn_01HX',
      skipBrowserRedirect: true
    })
    expect(data?.url).toBeTruthy()
    const params = new URL(data!.url!).searchParams
    expect(params.get('connection_id')).toBe('conn_01HX')
    expect(params.get('connection')).toBeNull()
  })

  it('falls back to connection when connection_id is absent', async () => {
    const auth = createClient(baseConfig)
    const { data } = await auth.signInWithOauthConnection({
      connection: 'google',
      skipBrowserRedirect: true
    })
    expect(data?.url).toBeTruthy()
    const params = new URL(data!.url!).searchParams
    expect(params.get('connection')).toBe('google')
    expect(params.get('connection_id')).toBeNull()
  })

  it('prefers connection_id when both are passed', async () => {
    const auth = createClient(baseConfig)
    const { data } = await auth.signInWithOauthConnection({
      connection: 'google',
      connection_id: 'conn_01HX',
      skipBrowserRedirect: true
    })
    expect(data?.url).toBeTruthy()
    const params = new URL(data!.url!).searchParams
    expect(params.get('connection_id')).toBe('conn_01HX')
    expect(params.get('connection')).toBeNull()
  })
})

describe('audience parameter', () => {
  it('omits audience when neither config nor per-call value is set', async () => {
    const auth = createClient(baseConfig)

    const authorizeUrl = auth.buildAuthorizeUrl()
    expect(new URL(authorizeUrl).searchParams.get('audience')).toBeNull()

    const { data } = await auth.signInWithOauthConnection({
      connection: 'google',
      skipBrowserRedirect: true
    })
    expect(new URL(data!.url!).searchParams.get('audience')).toBeNull()
  })

  it('emits config audience on buildAuthorizeUrl and OAuth connection URLs', async () => {
    const auth = createClient({
      ...baseConfig,
      audience: 'https://api.example.com'
    })

    const authorizeUrl = auth.buildAuthorizeUrl()
    expect(new URL(authorizeUrl).searchParams.get('audience')).toBe(
      'https://api.example.com'
    )

    const { data } = await auth.signInWithOauthConnection({
      connection: 'google',
      skipBrowserRedirect: true
    })
    expect(new URL(data!.url!).searchParams.get('audience')).toBe(
      'https://api.example.com'
    )
  })

  it('per-call audience on buildAuthorizeUrl overrides config default', () => {
    const auth = createClient({
      ...baseConfig,
      audience: 'https://api.example.com'
    })
    const url = auth.buildAuthorizeUrl({ audience: 'https://api.other.com' })
    expect(new URL(url).searchParams.get('audience')).toBe(
      'https://api.other.com'
    )
  })

  it('per-call audience on signInWithOauthConnection overrides config default', async () => {
    const auth = createClient({
      ...baseConfig,
      audience: 'https://api.example.com'
    })
    const { data } = await auth.signInWithOauthConnection({
      connection: 'google',
      audience: 'https://api.other.com',
      skipBrowserRedirect: true
    })
    expect(new URL(data!.url!).searchParams.get('audience')).toBe(
      'https://api.other.com'
    )
  })
})
