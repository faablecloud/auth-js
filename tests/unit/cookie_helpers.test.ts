import { describe, expect, it } from 'vitest'
import {
  parseCookies,
  serializeCookie,
  serializeCookieRemoval
} from '../../src/lib/storage/cookie_helpers'

describe('parseCookies', () => {
  it('returns an empty map for an empty string', () => {
    expect(parseCookies('')).toEqual(new Map())
  })

  it('parses a single name=value pair', () => {
    expect(parseCookies('foo=bar')).toEqual(new Map([['foo', 'bar']]))
  })

  it('parses multiple cookies separated by "; "', () => {
    expect(parseCookies('a=1; b=2; c=3')).toEqual(
      new Map([
        ['a', '1'],
        ['b', '2'],
        ['c', '3']
      ])
    )
  })

  it('decodes each value independently so encoded delimiters survive', () => {
    // Value contains an encoded semicolon and equals sign — these must NOT
    // be treated as cookie delimiters.
    const cookie = 'auth=a%3Bb%3Dc; other=plain'
    expect(parseCookies(cookie)).toEqual(
      new Map([
        ['auth', 'a;b=c'],
        ['other', 'plain']
      ])
    )
  })

  it('preserves "=" characters inside the value', () => {
    expect(parseCookies('token=ab%3D%3D')).toEqual(new Map([['token', 'ab==']]))
  })

  it('tolerates extra whitespace between pairs', () => {
    expect(parseCookies('a=1 ;   b=2')).toEqual(
      new Map([
        ['a', '1'],
        ['b', '2']
      ])
    )
  })

  it('decodes encoded keys', () => {
    expect(parseCookies('faable%20auth=1')).toEqual(
      new Map([['faable auth', '1']])
    )
  })

  it('skips entries with no "=" separator', () => {
    expect(parseCookies('orphan; a=1')).toEqual(new Map([['a', '1']]))
  })

  it('returns null-tolerant map when the value is empty', () => {
    expect(parseCookies('a=; b=2')).toEqual(
      new Map([
        ['a', ''],
        ['b', '2']
      ])
    )
  })
})

describe('serializeCookie', () => {
  it('serializes a basic name=value pair with URI-encoded value', () => {
    expect(serializeCookie('foo', 'a;b=c', {})).toBe('foo=a%3Bb%3Dc')
  })

  it('URI-encodes the cookie name', () => {
    expect(serializeCookie('faable auth', 'x', {})).toBe('faable%20auth=x')
  })

  it('appends Max-Age when provided, including the value 0', () => {
    expect(serializeCookie('a', 'b', { maxAge: 3600 })).toBe(
      'a=b; Max-Age=3600'
    )
    expect(serializeCookie('a', 'b', { maxAge: 0 })).toBe('a=b; Max-Age=0')
  })

  it('appends Domain, Path, SameSite and Secure when set', () => {
    expect(
      serializeCookie('a', 'b', {
        domain: '.example.com',
        path: '/api',
        sameSite: 'Strict',
        secure: true
      })
    ).toBe('a=b; Domain=.example.com; Path=/api; SameSite=Strict; Secure')
  })

  it('does not emit Secure when secure is false', () => {
    expect(serializeCookie('a', 'b', { secure: false })).toBe('a=b')
  })

  it('forces Secure when SameSite=None per the cookie spec', () => {
    expect(serializeCookie('a', 'b', { sameSite: 'None' })).toBe(
      'a=b; SameSite=None; Secure'
    )
  })
})

describe('serializeCookieRemoval', () => {
  it('produces a string that expires the cookie immediately', () => {
    const out = serializeCookieRemoval('foo', {})
    expect(out).toMatch(/^foo=/)
    expect(out).toMatch(/Max-Age=0/)
  })

  it('preserves Domain and Path so the browser actually removes it', () => {
    expect(
      serializeCookieRemoval('foo', { domain: '.example.com', path: '/api' })
    ).toBe('foo=; Max-Age=0; Domain=.example.com; Path=/api')
  })

  it('preserves SameSite and Secure when set', () => {
    expect(
      serializeCookieRemoval('foo', { sameSite: 'None', secure: true })
    ).toBe('foo=; Max-Age=0; SameSite=None; Secure')
  })
})
