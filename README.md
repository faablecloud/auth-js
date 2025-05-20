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
  <p align="center">An isomorphic Javascript library for Faable Auth</p>
</p>

<p align="center">
  <a aria-label="NPM version" href="https://www.npmjs.com/package/@faable/auth-js">
    <img alt="" src="https://img.shields.io/npm/v/@faable/auth-js.svg?style=for-the-badge&labelColor=000000">
  </a>
</p>

## Install

```bash
 npm install @faable/auth-js
```

## Configure

```js
import { createClient } from "@faable/auth-js";

export const auth = createClient({
  domain: "<faableauth_domain>",
  clientId: "<client_id>",
});
```

## Login

To login with a specific connection (Google, Facebook, etc.), you can set it once on your client instance.

```js
// Sign in using default connection
auth.signInWithOauthConnection();

// Or use specific connection
auth.signInWithOauthConnection({
  connection: "<connection_id>",
});
```
