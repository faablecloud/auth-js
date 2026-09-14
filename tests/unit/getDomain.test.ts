import { describe, expect, it, vi } from 'vitest'
import { getDomain } from '../../src/utils'

describe('getDomain', () => {
  it('keeps a domain that already includes the protocol', () => {
    expect(getDomain('https://tenant.auth.faable.link')).toBe(
      'https://tenant.auth.faable.link'
    )
  })

  it('defaults a remote host to https when the protocol is missing', () => {
    expect(getDomain('tenant.auth.faable.link')).toBe(
      'https://tenant.auth.faable.link'
    )
  })

  it('strips a trailing slash', () => {
    expect(getDomain('https://tenant.auth.faable.link/')).toBe(
      'https://tenant.auth.faable.link'
    )
  })

  it('trims surrounding whitespace', () => {
    expect(getDomain('  https://tenant.auth.faable.link  ')).toBe(
      'https://tenant.auth.faable.link'
    )
  })

  it('collapses a duplicated protocol', () => {
    expect(getDomain('https://https://tenant.auth.faable.link')).toBe(
      'https://tenant.auth.faable.link'
    )
  })

  it('preserves http (e.g. localhost)', () => {
    expect(getDomain('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('does not inherit the protocol of the page', () => {
    // Una app en http://localhost:3000 apuntaba al :80 del tenant, que no
    // atiende: 404 sin cabeceras CORS, y verde en producción.
    const location = { protocol: 'http:', host: 'localhost:3000' }
    vi.stubGlobal('location', location)
    try {
      expect(getDomain('tenant.auth.faable.link')).toBe(
        'https://tenant.auth.faable.link'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('defaults a loopback tenant to http', () => {
    // Un auth de desarrollo en local sí se sirve sin TLS.
    expect(getDomain('localhost:8080')).toBe('http://localhost:8080')
    expect(getDomain('127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(getDomain('auth.localhost')).toBe('http://auth.localhost')
    expect(getDomain('[::1]:8080')).toBe('http://[::1]:8080')
  })

  it('still honours an explicit protocol on a loopback host', () => {
    expect(getDomain('https://localhost:8443')).toBe('https://localhost:8443')
  })

  it('does not mistake a remote host that merely mentions localhost', () => {
    expect(getDomain('localhost.attacker.com')).toBe(
      'https://localhost.attacker.com'
    )
    expect(getDomain('mylocalhost')).toBe('https://mylocalhost')
    expect(getDomain('127.0.0.1.attacker.com')).toBe(
      'https://127.0.0.1.attacker.com'
    )
  })
})
