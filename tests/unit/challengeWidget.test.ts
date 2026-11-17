import { describe, expect, it } from 'vitest'
import { optionsFromClasses } from '../../src/lib/challenge_widget'

// What the integrator writes on the div wins over the JS options; this is the
// parser that decides what they wrote. The rendering itself is checked in a
// real browser (it needs Shadow DOM).
const el = (classes: string) =>
  ({
    classList: {
      forEach: (fn: (c: string) => void) =>
        classes.split(/\s+/).filter(Boolean).forEach(fn)
    }
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

  it('ignores unknown modifiers', () => {
    expect(optionsFromClasses(el('faable-challenge--purple'))).toEqual({})
  })
})
