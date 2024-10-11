<p align="center">
  <a href="https://faable.com">
    <img src="https://www.faable.com/logo/Emblem.png" height="96">
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

export const faableauth = createClient({
  domain: "<faableauth_domain>",
});
```

## Use specific connection

To login with a specific connection (Google, Facebook, etc.), you can set it once on your client instance.

```js
const faableauth = createClient({
  domain: "<faableauth_domain>",
  clientId: "<connection_client_id>", // Remove if you want to use default connection
});

// Later
faableauth.signInWithOauthConnection();
```

Or leave it blank on creation and specify it on login calls.

```js
// Later
faableauth.signInWithOauthConnection({
  connection: "<connection_client_id>",
});
```
