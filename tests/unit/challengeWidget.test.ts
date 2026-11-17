import { describe, expect, it } from 'vitest'
import { CHALLENGE_TEXTS } from '../../src/lib/challenge_i18n'
import { optionsFromClasses, textsFor } from '../../src/lib/challenge_widget'

// What the integrator writes on the div wins over the JS options; this is the
// parser that decides what they wrote. The rendering itself (Shadow DOM, the
// fit measurement, the transitions) is checked in a real browser.
const el = (classes: string, attrs: Record<string, string> = {}) =>
  ({
    classList: {
      forEach: (fn: (c: string) => void) =>
        classes.split(/\s+/).filter(Boolean).forEach(fn)
    },
    getAttribute: (name: string) => attrs[name] ?? null
  }) as unknown as Element

describe('optionsFromClasses', () => {
  it('reads theme, size, language and brand', () => {
    expect(
      optionsFromClasses(
        el(
          'contact faable-challenge--dark faable-challenge--compact faable-challenge--lang-es faable-challenge--no-brand'
        )
      )
    ).toEqual({ theme: 'dark', size: 'compact', locale: 'es', brand: false })
  })

  it('says nothing about what the classes do not mention', () => {
    expect(optionsFromClasses(el('faable-challenge--light'))).toEqual({
      theme: 'light'
    })
    expect(optionsFromClasses(el('btn primary'))).toEqual({})
  })

  it('data-lang wins over the language class', () => {
    expect(
      optionsFromClasses(el('faable-challenge--lang-en', { 'data-lang': 'ca' }))
    ).toEqual({ locale: 'ca' })
  })

  it('ignores unknown modifiers', () => {
    expect(optionsFromClasses(el('faable-challenge--purple'))).toEqual({})
  })
})

describe('textsFor', () => {
  it('region falls back to its language, unknown to English', () => {
    expect(textsFor('es-MX')).toBe(CHALLENGE_TEXTS.es)
    expect(textsFor('es_AR')).toBe(CHALLENGE_TEXTS.es)
    expect(textsFor('xx-YY')).toBe(CHALLENGE_TEXTS.en)
    expect(textsFor('')).toBe(CHALLENGE_TEXTS.en)
  })

  it('traditional Chinese regions read zh-Hant', () => {
    expect(textsFor('zh-TW')).toBe(CHALLENGE_TEXTS['zh-Hant'])
    expect(textsFor('zh-Hant-HK')).toBe(CHALLENGE_TEXTS['zh-Hant'])
    expect(textsFor('zh-CN')).toBe(CHALLENGE_TEXTS.zh)
  })

  it('every language a tenant can enable has all four texts', () => {
    for (const [code, t] of Object.entries(CHALLENGE_TEXTS)) {
      for (const k of ['idle', 'solving', 'done', 'error'] as const) {
        expect(t[k], `${code}.${k}`).toBeTruthy()
      }
    }
    expect(Object.keys(CHALLENGE_TEXTS).length).toBeGreaterThanOrEqual(116)
  })
})
