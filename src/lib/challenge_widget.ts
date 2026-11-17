import { CHALLENGE_EVENT, ChallengeState } from './challenge'
import { CHALLENGE_TEXTS, ChallengeTexts } from './challenge_i18n'
import { FAABLE_MARK_PNG } from './challenge_logo'
import { formInPlay } from './form_transaction'

/**
 * The optional, visible face of the bot-protection challenge: a tag (pill)
 * with an animated padlock, the state and the Faable mark — like Cloudflare's.
 * Whoever integrates decides: without a `[data-faable-challenge]` element the
 * challenge stays invisible.
 *
 *   <div data-faable-challenge data-lang="es" class="faable-challenge--dark"></div>
 *
 * Options, strongest first — what the integrator wrote on the element wins:
 *   data-lang="xx"                                  language
 *   faable-challenge--light | --dark | --auto       theme (white / black tag)
 *   faable-challenge--normal | --compact            force the full tag / the
 *                                                   round badge (default: fit)
 *   faable-challenge--lang-<xx>                     language
 *   faable-challenge--no-brand                      hide the Faable mark
 *   then `mountChallengeWidget(el, opts)`, then the closest `lang` attribute
 *   (the page's <html lang>), then the browser's language, then English.
 *
 * By default the size FITS: the full tag when it fits the space it has, the
 * round badge when it does not (a phone next to a submit button), re-decided
 * whenever that space changes.
 *
 * Rendered in a Shadow DOM with inline SVG and CSS — nothing fetched, so it
 * looks the same on any site and neither inherits nor leaks styles. It
 * follows the `faable-challenge` window event the library emits while it
 * solves, and re-emits `faable-challenge:<state>` on its own element; a click
 * on the error state emits `faable-challenge:retry`.
 */

export type WidgetTheme = 'light' | 'dark' | 'auto'
export type WidgetSize = 'fit' | 'normal' | 'compact'
export type WidgetState = 'idle' | ChallengeState

export type ChallengeWidgetOptions = {
  theme?: WidgetTheme
  size?: WidgetSize
  locale?: string
  brand?: boolean
}

// zh-TW and zh-HK read Traditional characters; the table keys them as zh-Hant.
const LOCALE_ALIASES: Record<string, string> = {
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  'sr-latn': 'sr-Latn',
  'pt-br': 'pt-BR'
}

/** Texts for a BCP 47 tag: exact or aliased variant → base language → English. */
export const textsFor = (locale: string | undefined | null): ChallengeTexts => {
  const tag = (locale || '').trim().replace('_', '-')
  const lower = tag.toLowerCase()
  const alias =
    LOCALE_ALIASES[lower] ??
    LOCALE_ALIASES[lower.split('-').slice(0, 2).join('-')]
  return (
    (alias && CHALLENGE_TEXTS[alias]) ||
    CHALLENGE_TEXTS[tag] ||
    CHALLENGE_TEXTS[lower.split('-')[0]] ||
    CHALLENGE_TEXTS.en
  )
}

const MARK = `<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><image href="${FAABLE_MARK_PNG}" width="14" height="14"/></svg>`

const LOCK =
  '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'

const icon = (state: WidgetState, ring: string) => {
  switch (state) {
    case 'solving':
      return `<span class="spin"><svg viewBox="0 0 36 36" width="26" height="26"><circle cx="18" cy="18" r="15" fill="none" stroke="${ring}" stroke-width="2.5"/><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="30 70" pathLength="100"/></svg></span><svg class="in" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${LOCK}</svg>`
    case 'done':
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#16a34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>'
    case 'error':
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
    default:
      return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LOCK}</svg>`
  }
}

/** Options the element itself states: `data-lang` and `faable-challenge--*`. */
export const optionsFromClasses = (
  el: Element
): Partial<Required<ChallengeWidgetOptions>> => {
  const out: Partial<Required<ChallengeWidgetOptions>> = {}
  el.classList.forEach(cls => {
    const m = /^faable-challenge--(.+)$/.exec(cls)
    if (!m) return
    const v = m[1]
    if (v === 'light' || v === 'dark' || v === 'auto') out.theme = v
    else if (v === 'normal' || v === 'compact') out.size = v
    else if (v === 'no-brand') out.brand = false
    else if (v.startsWith('lang-')) out.locale = v.slice(5)
  })
  const dataLang =
    typeof el.getAttribute === 'function' ? el.getAttribute('data-lang') : null
  if (dataLang) out.locale = dataLang
  return out
}

const resolveTheme = (theme: WidgetTheme): 'light' | 'dark' => {
  if (theme !== 'auto') return theme
  return typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

const px = (v: string) => parseFloat(v) || 0

/**
 * Width the element can take: its parent's content box, minus the siblings
 * sharing a non-wrapping flex row with it (and the gaps between them).
 */
export const availableWidth = (el: Element): number => {
  const parent = el.parentElement
  if (!parent || typeof getComputedStyle !== 'function') return Infinity
  const cs = getComputedStyle(parent)
  let space = parent.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)
  const own = getComputedStyle(el)
  space -= px(own.marginLeft) + px(own.marginRight)
  const rowFlex =
    /flex/.test(cs.display) &&
    !cs.flexDirection.startsWith('column') &&
    cs.flexWrap === 'nowrap'
  if (!rowFlex) return space
  let items = 0
  for (const child of Array.from(parent.children)) {
    if (child === el) continue
    const s = getComputedStyle(child)
    if (
      s.display === 'none' ||
      s.position === 'absolute' ||
      s.position === 'fixed'
    )
      continue
    space -=
      child.getBoundingClientRect().width + px(s.marginLeft) + px(s.marginRight)
    items++
  }
  return space - px(cs.columnGap) * items
}

type Palette = {
  bg: string
  fg: string
  sub: string
  border: string
  ring: string
}

const brandHtml = () =>
  `<span class="sep"></span><a class="brand" href="https://faable.com/auth?utm_source=${encodeURIComponent(
    typeof location !== 'undefined' ? location.hostname : ''
  )}&utm_medium=challenge_widget" target="_blank" rel="noopener">${MARK}<span>Faable Auth</span></a>`

const tagHtml = (
  state: WidgetState,
  o: Required<ChallengeWidgetOptions>,
  compact: boolean,
  cls = ''
) => {
  const texts = textsFor(o.locale)
  const brand = o.brand && !compact ? brandHtml() : ''
  return `<div class="tag${compact ? ' compact' : ''}${cls}" part="tag" data-state="${state}"${
    state === 'error' ? ' role="button" tabindex="0"' : ''
  }><span class="ic" aria-hidden="true">${icon(state, '')}</span><span class="${
    compact ? 'vh' : 'txt'
  }"${cls ? '' : ' role="status" aria-live="polite"'}>${texts[state]}</span>${brand}</div>`
}

const css = (T: Palette, dark: boolean, state: WidgetState) => `
:host{all:initial;display:inline-block;max-width:100%;vertical-align:middle}
.tag{box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px 0 10px;border:1px solid ${T.border};border-radius:999px;background:${T.bg};color:${T.fg};font:500 13px/1 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,${dark ? 0.4 : 0.06});white-space:nowrap;cursor:default;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.tag{overflow:hidden;transition:background-color .2s,color .2s,border-color .2s,box-shadow .2s,height .2s}
.tag.compact{width:32px;height:32px;padding:0;gap:0;justify-content:center}
.measurer{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;width:max-content}
.tag[data-state="error"]{cursor:pointer}
.measure{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none}
.ic{position:relative;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px}
.ic .layer{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.ic .spin{position:absolute;inset:0;display:flex;animation:r 1s linear infinite}
.ic .spin circle:first-child{stroke:${T.ring}}
.ic .in{position:relative}
@keyframes r{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ic .spin{animation:none}}
.txt{display:inline-block;transition:color .2s;color:${state === 'error' ? '#dc2626' : T.fg}}
.sep{width:1px;height:16px;background:${T.border}}
.brand{display:inline-flex;align-items:center;gap:5px;color:${T.sub};text-decoration:none;font-weight:600;font-size:11px;cursor:pointer}
.brand:hover{text-decoration:underline}
.brand svg{border-radius:3px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
`

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    bg: '#fff',
    fg: '#18181b',
    sub: '#71717a',
    border: '#e4e4e7',
    ring: '#e4e4e7'
  },
  dark: {
    bg: '#000',
    fg: '#fafafa',
    sub: '#a1a1aa',
    border: '#27272a',
    ring: '#3f3f46'
  }
}

const reducedMotion = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

const SKELETON =
  '<style></style><div class="tag" part="tag"><span class="ic" aria-hidden="true"></span><span class="txt" role="status" aria-live="polite"></span><span class="brandwrap"></span></div><div class="measurer" aria-hidden="true"></div>'

type Refs = {
  style: HTMLStyleElement
  tag: HTMLElement
  ic: HTMLElement
  txt: HTMLElement
  brand: HTMLElement
  measurer: HTMLElement
}

const refsOf = (root: ShadowRoot): Refs => {
  if (!root.querySelector('.tag')) root.innerHTML = SKELETON
  const q = (sel: string) => root.querySelector(sel) as HTMLElement
  return {
    style: q('style') as HTMLStyleElement,
    tag: q('.tag'),
    ic: q('.ic'),
    txt: q('.txt'),
    brand: q('.brandwrap'),
    measurer: q('.measurer')
  }
}

const EASE = 'cubic-bezier(.2,.7,.2,1)'

/**
 * Brings the widget to `state`. The nodes persist, so every change can be
 * animated: the icon cross-fades, the text fades in and the tag's width
 * slides from the old size to the new one (full tag ↔ round badge too).
 * Nothing moves under prefers-reduced-motion, or on the first paint.
 */
const render = (
  root: ShadowRoot,
  state: WidgetState,
  o: Required<ChallengeWidgetOptions>,
  host: Element,
  animate: boolean
) => {
  const r = refsOf(root)
  const dark = resolveTheme(o.theme) === 'dark'
  const T = PALETTES[dark ? 'dark' : 'light']
  r.style.textContent = css(T, dark, state)
  const motion =
    animate && !reducedMotion() && typeof r.tag.animate === 'function'

  // The error state keeps its words (the click retries): never compact.
  let compact = o.size === 'compact' && state !== 'error'
  if (o.size === 'fit' && state !== 'error') {
    r.measurer.innerHTML = tagHtml(state, o, false, ' measure')
    const natural = r.measurer.firstElementChild?.getBoundingClientRect().width
    r.measurer.innerHTML = ''
    compact = !!natural && natural > availableWidth(host) + 0.5
  }

  const from = r.tag.getBoundingClientRect().width
  const prevState = r.tag.dataset.state

  r.tag.dataset.state = state
  r.tag.classList.toggle('compact', compact)
  if (state === 'error') {
    r.tag.setAttribute('role', 'button')
    r.tag.setAttribute('tabindex', '0')
  } else {
    r.tag.removeAttribute('role')
    r.tag.removeAttribute('tabindex')
  }

  // Icon: a new layer on top of the old one, cross-faded.
  if (prevState !== state || !r.ic.firstElementChild) {
    const layer = document.createElement('span')
    layer.className = 'layer'
    layer.innerHTML = icon(state, '')
    const olds = Array.from(r.ic.children) as HTMLElement[]
    r.ic.appendChild(layer)
    if (motion && olds.length) {
      layer.animate(
        [
          { opacity: 0, transform: 'scale(.6)' },
          { opacity: 1, transform: 'scale(1)' }
        ],
        { duration: 220, easing: EASE }
      )
      for (const old of olds) {
        old
          .animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 160,
            easing: 'ease-out'
          })
          .finished.then(
            () => old.remove(),
            () => old.remove()
          )
      }
    } else {
      olds.forEach(old => old.remove())
    }
  }

  // Text (kept for screen readers when compact: it is the live region).
  const text = textsFor(o.locale)[state]
  r.txt.className = compact ? 'txt vh' : 'txt'
  if (r.txt.textContent !== text) {
    r.txt.textContent = text
    if (motion && !compact) {
      r.txt.animate(
        [
          { opacity: 0, transform: 'translateY(2px)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 200, easing: EASE }
      )
    }
  }

  // Brand: only on the full tag.
  const showBrand = o.brand && !compact
  if (showBrand && !r.brand.firstElementChild) {
    r.brand.innerHTML = brandHtml()
  } else if (!showBrand) {
    r.brand.innerHTML = ''
  }

  // Width: from the old size to the new natural one.
  const to = r.tag.getBoundingClientRect().width
  if (motion && from > 0 && Math.abs(to - from) > 0.5) {
    r.tag.animate([{ width: `${from}px` }, { width: `${to}px` }], {
      duration: 240,
      easing: EASE
    })
  }
}

export type ChallengeWidget = {
  setState: (state: WidgetState) => void
  /** Back to `idle`, for a form that can be sent again. */
  reset: () => void
  unmount: () => void
}

const MOUNTED = new WeakMap<Element, ChallengeWidget>()

const pageLocale = (el: Element): string => {
  const near =
    typeof el.closest === 'function'
      ? el.closest('[lang]')?.getAttribute('lang')
      : null
  if (near) return near
  if (typeof navigator !== 'undefined' && navigator.language)
    return navigator.language
  return 'en'
}

/** Draws the widget inside `el`. Calling it twice on one element is a no-op. */
export const mountChallengeWidget = (
  el: Element,
  opts: ChallengeWidgetOptions = {}
): ChallengeWidget => {
  const existing = MOUNTED.get(el)
  if (existing) return existing
  // A widget means a form: the clients fetch their form transaction now.
  formInPlay()
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  let state: WidgetState = 'idle'
  const options = (): Required<ChallengeWidgetOptions> => ({
    theme: 'auto',
    size: 'fit',
    brand: true,
    ...opts,
    locale: opts.locale ?? pageLocale(el),
    ...optionsFromClasses(el)
  })
  let frame = 0
  const paint = () => {
    if (frame) return
    const run = () => {
      frame = 0
      render(root, state, options(), el, true)
    }
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(run)
    } else {
      run()
    }
  }
  const setState = (next: WidgetState) => {
    state = next
    render(root, state, options(), el, true)
    el.dispatchEvent(
      new CustomEvent(`faable-challenge:${next}`, { bubbles: true })
    )
  }
  const onEvent = (ev: Event) => {
    const s = (ev as CustomEvent<{ state?: WidgetState }>).detail?.state
    if (s) setState(s)
  }
  const onActivate = (ev: Event) => {
    if (state !== 'error') return
    if (ev instanceof KeyboardEvent && ev.key !== 'Enter' && ev.key !== ' ')
      return
    const target = ev.composedPath()[0] as Element | undefined
    if (target?.closest?.('.brand')) return
    el.dispatchEvent(
      new CustomEvent('faable-challenge:retry', { bubbles: true })
    )
  }
  root.addEventListener('click', onActivate)
  root.addEventListener('keydown', onActivate)
  // A form that can be sent again: its native `reset` brings the badge back.
  const form = typeof el.closest === 'function' ? el.closest('form') : null
  const onReset = () => setState('idle')
  form?.addEventListener('reset', onReset)
  window.addEventListener(CHALLENGE_EVENT, onEvent)
  // A site that switches theme or language with a class or attribute drags
  // the widget along.
  const observer =
    typeof MutationObserver === 'function' ? new MutationObserver(paint) : null
  observer?.observe(el, {
    attributes: true,
    attributeFilter: ['class', 'data-lang', 'lang']
  })
  // The space it has: the parent's box and its row siblings (a button whose
  // label changes to "Sending…" takes room from the tag).
  const resize =
    typeof ResizeObserver === 'function' ? new ResizeObserver(paint) : null
  if (resize && el.parentElement) {
    resize.observe(el.parentElement)
    for (const sib of Array.from(el.parentElement.children)) {
      if (sib !== el) resize.observe(sib)
    }
  }
  const media =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-color-scheme: dark)')
      : null
  media?.addEventListener?.('change', paint)
  render(root, state, options(), el, false)
  const widget: ChallengeWidget = {
    setState,
    reset: () => setState('idle'),
    unmount: () => {
      form?.removeEventListener('reset', onReset)
      window.removeEventListener(CHALLENGE_EVENT, onEvent)
      root.removeEventListener('click', onActivate)
      root.removeEventListener('keydown', onActivate)
      observer?.disconnect()
      resize?.disconnect()
      media?.removeEventListener?.('change', paint)
      root.innerHTML = ''
      MOUNTED.delete(el)
    }
  }
  MOUNTED.set(el, widget)
  return widget
}

/**
 * Brings every mounted widget under `root` (or `el` itself) back to `idle` —
 * for a form that stays on the page and can be sent again.
 */
export const resetChallengeWidgets = (
  root: ParentNode | Element = document
) => {
  const els =
    root instanceof Element && root.matches('[data-faable-challenge]')
      ? [root]
      : Array.from(root.querySelectorAll('[data-faable-challenge]'))
  for (const el of els) MOUNTED.get(el)?.reset()
}

/** Mounts a widget in every `[data-faable-challenge]` of the page. */
export const mountChallengeWidgets = (root: ParentNode = document) => {
  root
    .querySelectorAll('[data-faable-challenge]')
    .forEach(el => mountChallengeWidget(el))
}

let watching = false

/**
 * Mounts the widgets on the page now and any added later (a React form that
 * renders after `createClient`). Idempotent; a no-op outside a browser.
 */
export const watchChallengeWidgets = () => {
  if (watching || typeof document === 'undefined') return
  if (typeof window === 'undefined' || typeof MutationObserver !== 'function')
    return
  watching = true
  const scan = () => mountChallengeWidgets(document)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true })
  } else {
    scan()
  }
  new MutationObserver(records => {
    for (const r of records) {
      r.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return
        if (node.matches('[data-faable-challenge]')) mountChallengeWidget(node)
        mountChallengeWidgets(node)
      })
    }
  }).observe(document.documentElement, { childList: true, subtree: true })
}
