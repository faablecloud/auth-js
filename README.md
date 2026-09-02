<p align="center">
  <a href="https://faable.com">
    <img src="https://www.faable.com/assets/logo/Emblem.png" height="96">
    <h3 align="center">Faable</h3>
  </a>
</p>

<p align="center">
  <a href="https://faable.com">
    <h1 align="center">auth-js</h1>
  </a>
  <p align="center">An isomorphic JavaScript client for Faable Auth.</p>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/@faable/auth-js">
    <img alt="" src="https://img.shields.io/npm/v/@faable/auth-js.svg?style=for-the-badge&labelColor=000000">
  </a>
</p>

<p align="center">
  📚 Full documentation at <a href="https://faable.com/docs">faable.com/docs</a>
</p>

## Features

- OAuth social connections (Google, GitHub, …) with PKCE and implicit flows
- Username + password login
- Passwordless: email magic link and OTP code
- Automatic token refresh with cross-tab synchronization via `BroadcastChannel`
- Pluggable storage adapters (`localStorage`, cookies, or custom)
- Server-side session helpers for Next.js

## Install

```bash
npm install @faable/auth-js
```

Requires Node.js `>=22.8` for development. The published bundle runs in any
modern browser and in Node/SSR environments.

## Quick start

```ts
import { createClient } from '@faable/auth-js'

export const auth = createClient({
  domain: '<faableauth_domain>',
  clientId: '<client_id>',
  redirectUri: window.location.origin
})

// Trigger a social login
await auth.signInWithOauthConnection({ connection: 'google' })
```

## Configuration

`createClient(config)` accepts:

| Option          | Type               | Description                                                                                                                                              |
| --------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`        | `string`           | **Required.** Your Faable Auth tenant domain. The protocol is optional — `tenant.auth.faable.link` and `https://tenant.auth.faable.link` are equivalent. |
| `clientId`      | `string`           | **Required.** Application client ID.                                                                                                                     |
| `redirectUri`   | `string`           | Default callback URL. Falls back to `window.location.origin`.                                                                                            |
| `scope`         | `string`           | Space-separated scopes. Defaults to `openid profile email`.                                                                                              |
| `storage`       | `SupportedStorage` | Custom storage adapter. Defaults to `localStorage`.                                                                                                      |
| `storageKey`    | `string`           | Prefix for the storage key. Final key is `${storageKey}-${clientId}`.                                                                                    |
| `cookieOptions` | `CookieOptions`    | When set, switches storage to the cookie adapter.                                                                                                        |
| `lock`          | `LockFunc`         | Custom locking primitive for concurrent refreshes.                                                                                                       |
| `debug`         | `boolean`          | Enables verbose logging.                                                                                                                                 |

## Authentication flows

### OAuth / social connection

```ts
// Use the default connection configured on the tenant
await auth.signInWithOauthConnection({})

// Or pick a specific provider (by name or connection_id)
await auth.signInWithOauthConnection({
  connection_id: 'conn_01HX…', // preferred when known; falls back to `connection` for legacy tenants
  redirectTo: 'https://app.example.com/callback',
  scopes: 'openid profile email',
  queryParams: { prompt: 'select_account' }
})
```

In browsers the SDK uses the PKCE flow by default and exchanges the `code` for a
session on the callback page. The first call to `createClient` automatically
processes the URL when the user lands back on the redirect target.

On the redirect success path the returned promise **does not resolve** — the
browser is already navigating away, so a loading state you bind to the `await`
stays on until the page unloads instead of flashing back to idle. Do not
re-enable UI after the `await` on this path.

To control the navigation yourself (e.g. custom timing, or a non-redirecting
runtime), pass `skipBrowserRedirect: true`. The call then resolves with the
authorization URL and leaves the navigation to you:

```ts
const { data, error } = await auth.signInWithOauthConnection({
  connection: 'google',
  skipBrowserRedirect: true
})
if (error) throw error
window.location.assign(data.url)
```

### Username + password

```ts
await auth.signInWithUsernamePassword({
  username: 'user@example.com',
  password: '••••••••',
  redirectTo: 'https://app.example.com/callback'
})
```

### Passwordless (magic link or OTP)

```ts
// Step 1 — request a code or link
await auth.signInWithPasswordless({
  email: 'user@example.com',
  type: 'code' // or "link"
})

// Step 2 — complete the login with the OTP the user received
const { data, error } = await auth.signInWithOtp({
  username: 'user@example.com',
  otp: '123456'
})
```

### Password reset

```ts
await auth.changePassword({ email: 'user@example.com' })
```

### Sign out

By default `signOut()` (global scope, in a browser) **navigates the page to the
auth server's `/logout`** to clear the SSO cookie, then returns to `returnTo` if
you pass one. This matters: the SSO cookie lives on the auth domain, so a
cross-origin `fetch` from your app can neither send nor clear it. Without the
navigation the SSO session survives and the next `signInWith…` silently re-logs
the previous user, ignoring the requested connection.

```ts
await auth.signOut() // clears local + redirects to /logout to clear the SSO cookie
await auth.signOut({ returnTo: 'https://app.example.com/bye' }) // + landing page
await auth.signOut({ scope: 'local' }) // only this device's storage, no redirect
await auth.signOut({ redirect: false }) // legacy: local + best-effort fetch, no nav
```

`returnTo` maps to the OIDC `post_logout_redirect_uri` and **must be registered
as a logout URL on the client**, or the server responds `400`.

On the redirect path the returned promise does not resolve (the browser is
navigating away) — do not re-enable UI after the `await`. To drive the
navigation yourself, build the URL with `getLogoutUrl`:

```ts
window.location.assign(
  auth.getLogoutUrl({ returnTo: 'https://app.example.com' })
)
```

## Error handling

The client has **one error contract, applied uniformly**: every asynchronous
method resolves with `{ data, error }` and **never throws for an expected
failure** (bad credentials, wrong OTP, missing session, network error…). On
success `error` is `null`; on failure `data` is `null` and `error` is an
`AuthError`. Always check `error` before reading `data`:

```ts
const { data, error } = await auth.signInWithOtp({ username, otp })
if (error) {
  showError(error.message)
  return
}
useSession(data.session)
```

The only thing that throws is `createClient` itself, and only for a
misconfiguration (missing `domain` / `clientId`) — a programming error you fix
once, not a runtime condition to catch.

This applies to `signInWithOauthConnection`, `signInWithUsernamePassword`,
`signUp`, `signInWithOtp`, `signInWithPasswordless`, `changePassword`,
`changeEmail`, `signOut`, `getSession`, `getClaims`, `setSession`,
`refreshSession`, `initialize` and `handleRedirectCallback`. Their return types
(`AuthResult<T>`, `AuthResponse`, `OAuthResponse`) are all variants of the same
shape.

### Prefer throw-style? Use `unwrap`

If your code path would rather let errors propagate (a server handler, a
`try/catch`, a wrapper that normalizes everything to throws), wrap the call in
`unwrap` instead of hand-writing `if (error) throw error`:

```ts
import { unwrap } from '@faable/auth-js'

// returns data on success, throws the AuthError on failure
const { session } = unwrap(await auth.signInWithOtp({ username, otp }))
```

## Sessions and state changes

```ts
// Get the current session (refreshes if needed)
const {
  data: { session }
} = await auth.getSession()

// Subscribe to auth events
const {
  data: { subscription }
} = auth.onAuthStateChange((event, session) => {
  // event: INITIAL_SESSION | SIGNED_IN | SIGNED_OUT | TOKEN_REFRESHED | PASSWORD_RECOVERY | USER_UPDATED
})

// Stop listening
subscription.unsubscribe()

// Force a refresh
await auth.refreshSession()
```

Auth events are broadcast across tabs using `BroadcastChannel`, so a sign-in or
sign-out in one tab is reflected in every other tab using the same `storageKey`.

### Reading token claims

Custom claims your tenant puts on the access token — a connection's
`claims_mapping` or an Action's `api.accessToken.setCustomClaim` — are available
two ways:

- On the user: `/me` returns them as top-level properties, so
  `session.user['ciapol.com/station_id']` just works.
- Decoded from the token, without a request:

```ts
// Typed by namespace; refreshes an expired session first, like getSession()
const { data } = await auth.getClaims<{ 'ciapol.com/station_id': string }>()
data.claims?.['ciapol.com/station_id'] // 'station_123456789'
data.claims?.scope // standard claims are typed too

// One claim, or null when signed out / absent
const station = await auth.getClaim<string>('ciapol.com/station_id')
```

The token is decoded, not signature-verified: use claims for UI and routing
decisions, never as authorization — that is the resource server's job. Custom
claims are frozen at login and survive refreshes; they change on the next
sign-in.

## Storage adapters

### Trade-offs

Refresh tokens are sensitive: anyone who reads them can impersonate the user
until the token is revoked. The storage you pick decides where they live:

- **`localStorage` (default)** — simple and supports cross-tab sync via
  `BroadcastChannel`, but any script running on the same origin can read it. **A
  single XSS lets an attacker exfiltrate the refresh token.** Acceptable for
  low-risk apps and prototypes; not recommended when the surface has third-party
  scripts, user-generated HTML, or strict compliance requirements.
- **Cookies** — required for SSR (server reads them on every request) and the
  only adapter that lets you scope storage with `Secure`, `SameSite`, and
  `Domain`. Note that this library writes cookies from JavaScript, so they
  cannot be marked `HttpOnly`; an XSS can still read them, but cookies make CSRF
  and same-site policies enforceable in a way `localStorage` does not.
- **Custom adapter** — use for in-memory storage (tokens lost on reload, safest
  against XSS), Web Workers, or platform-specific keychains.

If your app is exposed to untrusted content, prefer cookies with `Secure: true`
and `SameSite: "Lax"` (or `"Strict"`), and treat XSS prevention (CSP, escaping,
framework guarantees) as a hard requirement regardless of which adapter you
pick.

### localStorage (default)

Used automatically in browsers. No configuration required.

### Cookies

Useful for SSR setups where the server must read the session from the request.

```ts
import { createClient } from '@faable/auth-js'

export const auth = createClient({
  domain: '<faableauth_domain>',
  clientId: '<client_id>',
  storage: 'cookie'
})
```

That's it. The adapter sets sensible defaults: `Path=/`, `SameSite=Lax`, auto
`Secure` on HTTPS, and a 30-day `Max-Age` so users stay signed in across browser
restarts.

Use `cookieOptions` only when you need to override something — e.g. share the
session across subdomains:

```ts
createClient({
  domain: '<faableauth_domain>',
  clientId: '<client_id>',
  storage: 'cookie',
  cookieOptions: { domain: '.example.com' }
})
```

### Custom adapter

Provide any object that implements `getItem`, `setItem`, and `removeItem` (sync
or async). Set `isServer: true` if values may come from an untrusted source such
as request cookies.

```ts
const memoryStorage = {
  store: new Map<string, string>(),
  getItem: (k: string) => memoryStorage.store.get(k) ?? null,
  setItem: (k: string, v: string) => void memoryStorage.store.set(k, v),
  removeItem: (k: string) => void memoryStorage.store.delete(k)
}

createClient({ domain, clientId, storage: memoryStorage })
```

## Next.js / server-side

Use `storage: 'cookie'` on the client, then read the session on the server with
`getSessionFromCookies`. It returns the full `Session` (`access_token`,
`refresh_token`, `expires_at`, `user`) or `null`, and accepts the `cookies()`
object from `next/headers`, a `NextRequest.cookies` object, or a plain
`{ name: value }` map.

`getSessionFromCookies` is **async** — always `await` it. In Next.js 15+,
`cookies()` is also async, so `await` that too:

```ts
// app/page.tsx (Next.js 15+)
import { cookies } from 'next/headers'
import { getSessionFromCookies } from '@faable/auth-js'

export default async function Page() {
  const session = await getSessionFromCookies(await cookies(), {
    clientId: '<client_id>'
  })
  if (!session) return <SignIn />
  return <Dashboard user={session.user} />
}
```

On Next.js 14 and earlier `cookies()` is synchronous — drop the inner `await`
(`await getSessionFromCookies(cookies(), …)`).

### Gating routes in middleware (Edge)

To keep protected content from ever reaching the browser without a session, gate
it in `middleware.ts`. Pass `req.cookies` (a `NextRequest.cookies` object)
directly:

```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookies } from '@faable/auth-js'

export async function middleware(req: NextRequest) {
  const session = await getSessionFromCookies(req.cookies, {
    clientId: '<client_id>'
  })
  if (!session) return NextResponse.redirect(new URL('/login', req.url))
  return NextResponse.next()
}

export const config = { matcher: ['/((?!login|_next|favicon.ico).*)'] }
```

Pass the same `clientId` you used in `createClient`. If you also passed a custom
`storageKey` to `createClient`, mirror it here as `{ clientId, storageKey }` so
the helper looks at the same cookie.

> **Security note.** This library writes the session cookie from JavaScript, so
> it **cannot** be `HttpOnly` — an XSS can read the `access_token`. Treat XSS
> prevention (CSP, escaping) as a hard requirement. The cookie may also be
> **chunked** across `faableauth-<clientId>.0`, `.1`, … when large;
> `getSessionFromCookies` reassembles the chunks for you, but any code that
> reads the cookie by hand (another backend, an edge worker) must rejoin them.

> **`returnTo` vs `redirectTo`.** Don't embed `returnTo` inside the `redirectTo`
> query (e.g. `redirectTo: '/callback?returnTo=/x'`) — pass `returnTo` as its
> own option (`signInWith…({ returnTo: '/x' })`). The SDK stores it locally next
> to the PKCE verifier and round-trips it back to you; keep `redirectTo` a clean
> URL with no query.

## Documentation

For the full guides, API reference, and dashboard setup walkthroughs visit
[faable.com/docs](https://faable.com/docs).

## License

See [LICENSE.md](LICENSE.md).
