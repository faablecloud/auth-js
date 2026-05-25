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

| Option          | Type               | Description                                                           |
| --------------- | ------------------ | --------------------------------------------------------------------- |
| `domain`        | `string`           | **Required.** Your Faable Auth tenant domain.                         |
| `clientId`      | `string`           | **Required.** Application client ID.                                  |
| `redirectUri`   | `string`           | Default callback URL. Falls back to `window.location.origin`.         |
| `scope`         | `string`           | Space-separated scopes. Defaults to `openid profile email`.           |
| `storage`       | `SupportedStorage` | Custom storage adapter. Defaults to `localStorage`.                   |
| `storageKey`    | `string`           | Prefix for the storage key. Final key is `${storageKey}-${clientId}`. |
| `cookieOptions` | `CookieOptions`    | When set, switches storage to the cookie adapter.                     |
| `lock`          | `LockFunc`         | Custom locking primitive for concurrent refreshes.                    |
| `debug`         | `boolean`          | Enables verbose logging.                                              |

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

```ts
await auth.signOut() // global — all sessions for this user
await auth.signOut({ scope: 'local' }) // only this device
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
`Secure` on HTTPS, and a 30-day `Max-Age` so users stay signed in across
browser restarts.

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

Use cookie storage on the client, then read the session from `next/headers` on
the server:

```ts
// app/page.tsx
import { cookies } from "next/headers";
import { getSessionFromCookies } from "@faable/auth-js";

export default async function Page() {
  const session = getSessionFromCookies(cookies(), "faable.auth.token-<client_id>");
  if (!session) return <SignIn />;
  return <Dashboard user={session.user} />;
}
```

The storage key follows the pattern
`${storageKey ?? "faable.auth.token"}-${clientId}`.

## License

See [LICENSE.md](LICENSE.md).
