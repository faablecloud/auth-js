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
