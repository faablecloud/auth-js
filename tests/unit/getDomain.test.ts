import { describe, expect, it } from 'vitest'
import { getDomain } from '../../src/utils'

describe('getDomain', () => {
  it('keeps a domain that already includes the protocol', () => {
    expect(getDomain('https://tenant.auth.faable.link')).toBe(
      'https://tenant.auth.faable.link'
    )
  })

  it('prefixes a protocol when missing', () => {
    // El protocolo por defecto depende del entorno (browser hereda el del
    // documento, fuera de él es https); lo importante es que el host quede bien.
    expect(getDomain('tenant.auth.faable.link')).toMatch(
      /^https?:\/\/tenant\.auth\.faable\.link$/
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
})
