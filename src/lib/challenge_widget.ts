import {
  mountChallengeWidget as mount,
  mountChallengeWidgets as mountAll,
  watchChallengeWidgets as watchAll
} from '@faable/challenge'
import type {
  ChallengeWidget,
  ChallengeWidgetDriver,
  ChallengeWidgetOptions
} from '@faable/challenge'
import { formInPlay } from './form_transaction'

/**
 * The optional, visible face of the signup challenge: the Faable badge next
 * to the submit button. Since auth-js 3.7 it is `@faable/challenge`'s widget
 * (bundled), driven the way auth-js always drove it:
 *
 *   <div data-faable-challenge data-lang="es" class="faable-challenge--dark"></div>
 *
 * - it follows the page-wide `faable-challenge` event the library emits while
 *   it solves (`followWindowEvents`);
 * - it names Faable Auth;
 * - a widget on the page means a form: mounting one makes the clients fetch
 *   their form transaction token (`formInPlay`, §546).
 *
 * Options and classes are the same as before (themes, `fit`/`compact`,
 * `data-lang`, `--no-brand`); see `@faable/challenge`.
 */

const AUTH_DRIVER: ChallengeWidgetDriver = {
  followWindowEvents: true,
  product: 'auth',
  activateOnClick: false,
  onMount: formInPlay
}

export type {
  ChallengeWidget,
  ChallengeWidgetOptions,
  WidgetSize,
  WidgetState,
  WidgetTheme
} from '@faable/challenge'
export { resetChallengeWidgets } from '@faable/challenge'

/** Draws the badge inside `el`. Calling it twice on one element is a no-op. */
export const mountChallengeWidget = (
  el: Element,
  opts: ChallengeWidgetOptions = {}
): ChallengeWidget => mount(el, opts, AUTH_DRIVER)

/** Mounts a badge in every `[data-faable-challenge]` under `root`. */
export const mountChallengeWidgets = (root: ParentNode = document) =>
  mountAll(root, AUTH_DRIVER)

/**
 * Mounts the badges on the page now and any added later (a React form that
 * renders after `createClient`). Idempotent; a no-op outside a browser.
 */
export const watchChallengeWidgets = () => watchAll(AUTH_DRIVER)
