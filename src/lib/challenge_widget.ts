import { CHALLENGE_EVENT, ChallengeState } from './challenge'

/**
 * The optional, visible face of the bot-protection challenge: a tag (pill)
 * with an animated padlock, the state and the Faable mark — like Cloudflare's.
 * Whoever integrates decides: without a `[data-faable-challenge]` element the
 * challenge stays invisible.
 *
 *   <div data-faable-challenge class="faable-challenge--dark faable-challenge--lang-es"></div>
 *
 * Options come from classes on that element (they win: they are what the
 * integrator wrote) or from `mountChallengeWidget(el, opts)`:
 *   faable-challenge--light | --dark | --auto     theme (white / black tag)
 *   faable-challenge--normal | --compact          compact = a round badge
 *   faable-challenge--lang-<xx>                   texts (es, en)
 *   faable-challenge--no-brand                    hide the Faable mark
 *
 * Rendered in a Shadow DOM with inline SVG and CSS — nothing external, so it
 * looks the same on any site and neither inherits nor leaks styles. It
 * follows the `faable-challenge` window event that the library emits while it
 * solves, and re-emits `faable-challenge:<state>` on its own element.
 */

export type WidgetTheme = 'light' | 'dark' | 'auto'
export type WidgetSize = 'normal' | 'compact'
export type WidgetState = 'idle' | ChallengeState

export type ChallengeWidgetOptions = {
  theme?: WidgetTheme
  size?: WidgetSize
  locale?: string
  brand?: boolean
}

const TEXTS: Record<string, Record<WidgetState, string>> = {
  es: {
    idle: 'Protegido contra bots',
    solving: 'Comprobando que eres una persona…',
    done: 'Verificado',
    error: 'No se pudo verificar'
  },
  en: {
    idle: 'Protected against bots',
    solving: 'Checking you are human…',
    done: 'Verified',
    error: 'Could not verify'
  }
}

// ⚠️ Placeholder mark until the Faable emblem exists as SVG (today only the
// 385 KB PNG at faable.com/assets/logo/Emblem.png). Replace this constant.
const FAABLE_MARK = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><defs><linearGradient id="fm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset=".55" stop-color="#a855f7"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><path fill="url(#fm)" d="M13.5 1 4 13.2h6.3L8.6 23 20 9.8h-6.6z"/></svg>`

const LOCK =
  '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'

const icon = (state: WidgetState, ring: string, px: number) => {
  switch (state) {
    case 'solving':
      return `<span class="spin"><svg viewBox="0 0 36 36" width="${px}" height="${px}"><circle cx="18" cy="18" r="15" fill="none" stroke="${ring}" stroke-width="2.5"/><circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="30 70" pathLength="100"/></svg></span><svg class="in" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${LOCK}</svg>`
    case 'done':
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#16a34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>'
    case 'error':
      return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
    default:
      return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${LOCK}</svg>`
  }
}

/** Options from `faable-challenge--*` classes; only what the classes say. */
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
  return out
}

const resolveTheme = (theme: WidgetTheme): 'light' | 'dark' => {
  if (theme !== 'auto') return theme
  return typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

const render = (
  root: ShadowRoot,
  state: WidgetState,
  o: Required<ChallengeWidgetOptions>
) => {
  const dark = resolveTheme(o.theme) === 'dark'
  const T = dark
    ? {
        bg: '#000',
        fg: '#fafafa',
        sub: '#a1a1aa',
        border: '#27272a',
        ring: '#3f3f46'
      }
    : {
        bg: '#fff',
        fg: '#18181b',
        sub: '#71717a',
        border: '#e4e4e7',
        ring: '#e4e4e7'
      }
  // Compact is a perfect circle — except on error, which needs its words.
  const compact = o.size === 'compact' && state !== 'error'
  const H = compact ? 32 : 36
  const texts = TEXTS[o.locale] ?? TEXTS[o.locale.split('-')[0]] ?? TEXTS.en
  const brand =
    o.brand && !compact
      ? `<span class="sep"></span><a class="brand" href="https://faable.com/auth?utm_source=${encodeURIComponent(
          typeof location !== 'undefined' ? location.hostname : ''
        )}&utm_medium=challenge_widget" target="_blank" rel="noopener">${FAABLE_MARK}<span>Faable Auth</span></a>`
      : ''
  root.innerHTML = `<style>
:host{all:initial;display:inline-block}
.tag{box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;height:${H}px;padding:0 12px 0 10px;border:1px solid ${T.border};border-radius:999px;background:${T.bg};color:${T.fg};font:500 13px/1 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,${dark ? 0.4 : 0.06});white-space:nowrap}
.tag.compact{width:${H}px;padding:0;gap:0;justify-content:center}
.ic{position:relative;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px}
.ic .spin{position:absolute;inset:0;display:flex;animation:r 1s linear infinite}
.ic .in{position:relative}
@keyframes r{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.ic .spin{animation:none}}
.txt{color:${state === 'error' ? '#dc2626' : T.fg}}
.sep{width:1px;height:16px;background:${T.border}}
.brand{display:inline-flex;align-items:center;gap:5px;color:${T.sub};text-decoration:none;font-weight:600;font-size:11px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style><div class="tag${compact ? ' compact' : ''}" part="tag" data-state="${state}"><span class="ic" aria-hidden="true">${icon(
    state,
    T.ring,
    26
  )}</span><span class="${compact ? 'vh' : 'txt'}" role="status" aria-live="polite">${
    texts[state]
  }</span>${brand}</div>`
}

export type ChallengeWidget = {
  setState: (state: WidgetState) => void
  unmount: () => void
}

const MOUNTED = new WeakMap<Element, ChallengeWidget>()

/** Draws the widget inside `el`. Calling it twice on one element is a no-op. */
export const mountChallengeWidget = (
  el: Element,
  opts: ChallengeWidgetOptions = {}
): ChallengeWidget => {
  const existing = MOUNTED.get(el)
  if (existing) return existing
  const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  let state: WidgetState = 'idle'
  const options = (): Required<ChallengeWidgetOptions> => ({
    theme: 'auto',
    size: 'normal',
    locale:
      (typeof document !== 'undefined' && document.documentElement.lang) ||
      'en',
    brand: true,
    ...opts,
    ...optionsFromClasses(el)
  })
  const paint = () => render(root, state, options())
  const setState = (next: WidgetState) => {
    state = next
    paint()
    el.dispatchEvent(
      new CustomEvent(`faable-challenge:${next}`, { bubbles: true })
    )
  }
  const onEvent = (ev: Event) => {
    const s = (ev as CustomEvent<{ state?: WidgetState }>).detail?.state
    if (s) setState(s)
  }
  window.addEventListener(CHALLENGE_EVENT, onEvent)
  // A site that switches to dark mode with a class drags the widget along.
  const observer =
    typeof MutationObserver === 'function' ? new MutationObserver(paint) : null
  observer?.observe(el, { attributes: true, attributeFilter: ['class'] })
  const media =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-color-scheme: dark)')
      : null
  media?.addEventListener?.('change', paint)
  paint()
  const widget: ChallengeWidget = {
    setState,
    unmount: () => {
      window.removeEventListener(CHALLENGE_EVENT, onEvent)
      observer?.disconnect()
      media?.removeEventListener?.('change', paint)
      root.innerHTML = ''
      MOUNTED.delete(el)
    }
  }
  MOUNTED.set(el, widget)
  return widget
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
