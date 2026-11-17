import { FaableAuthClient } from './FaableAuthClient'
import { watchChallengeWidgets } from './lib/challenge_widget'
import { armTransaction } from './lib/form_transaction'
import { FaableAuthClientConfig } from './lib/types'

/**
 * Creates a {@link FaableAuthClient} bound to a Faable Auth tenant.
 *
 * This is the recommended entry point for app code. The returned client
 * begins initializing its session in the background as soon as it's created,
 * so you can start subscribing to events or triggering sign-ins right away.
 *
 * @param config Tenant settings. `domain` and `clientId` are required.
 * @example
 * ```ts
 * import { createClient } from '@faable/auth-js'
 *
 * export const auth = createClient({
 *   domain: '<faableauth_domain>',
 *   clientId: '<client_id>',
 *   redirectUri: window.location.origin
 * })
 * ```
 * @see {@link https://faable.com/docs/auth/get-started | Get Started with Faable Auth}
 * @see {@link https://faable.com/docs/auth/clients | Clients}
 * @category Getting started
 */
export const createClient = (config: FaableAuthClientConfig) => {
  // The optional bot-protection badge: draws itself in any
  // `[data-faable-challenge]` element (lib/challenge_widget.ts).
  watchChallengeWidgets()
  const client = new FaableAuthClient(config)
  // The form transaction token for signup and passwordless: fetched once a
  // form is in play (first focus inside a <form>, or a challenge widget), not
  // on every page load. Browser only; a no-op in SSR and Node
  // (lib/form_transaction.ts).
  armTransaction(client._formTransactions)
  return client
}
