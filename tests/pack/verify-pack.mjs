#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const PKG = join(ROOT, 'pkg')

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts })
const capture = (cmd, opts = {}) =>
  execSync(cmd, { encoding: 'utf8', ...opts }).trim()

console.log('→ Building pkg/')
run('npm run build', { cwd: ROOT })

const tmp = mkdtempSync(join(tmpdir(), 'faable-auth-js-pack-'))
console.log(`→ Workspace: ${tmp}`)

try {
  console.log('→ Packing pkg/')
  const tarballName = capture('npm pack --silent --pack-destination .', {
    cwd: PKG
  })
  const tarballPath = join(PKG, tarballName)

  console.log('→ Installing tarball into a clean consumer')
  writeFileSync(
    join(tmp, 'package.json'),
    JSON.stringify(
      { name: 'consumer', version: '0.0.0', type: 'module', private: true },
      null,
      2
    )
  )
  run(`npm install --silent --no-save "${tarballPath}"`, { cwd: tmp })

  console.log('→ Resolving the published exports')
  const probe = `
    import { readFileSync } from "node:fs";
    import { createRequire } from "node:module";

    // Browser-ish globals BEFORE the package loads: the bundle captures
    // \`window\`/\`document\` at module-evaluation time (lib/globals), so a
    // static \`import * as mod\` — hoisted above any statement — would freeze
    // them as undefined for the whole probe. Hence the dynamic import below.
    // The URL starts CLEAN — clients created for the export checks auto-
    // initialize, and they must not consume the error params the assertions
    // below stage later.
    const loc = { href: "https://app.example.com/page", origin: "https://app.example.com" };
    globalThis.window = { location: loc, history: { state: null, replaceState: (s, t, u) => { loc.href = u; } }, addEventListener: () => {}, removeEventListener: () => {} };
    globalThis.document = {};
    const mod = await import("@faable/auth-js");

    const required = ["createClient", "FaableAuthClient", "AuthError"];
    const missing = required.filter((name) => typeof mod[name] === "undefined");
    if (missing.length) {
      console.error("Missing exports:", missing);
      process.exit(1);
    }

    const requireModule = createRequire(import.meta.url);
    const pkgPath = requireModule.resolve("@faable/auth-js/package.json");
    const pkgJson = JSON.parse(readFileSync(pkgPath, "utf8"));

    if (!pkgJson.exports || typeof pkgJson.exports !== "object") {
      console.error("Published package.json is missing an 'exports' map");
      process.exit(1);
    }
    if (pkgJson.sideEffects !== false) {
      console.error("Published package.json must declare 'sideEffects: false' for tree-shaking");
      process.exit(1);
    }

    const client = mod.createClient({ domain: "https://example.com", clientId: "test" });
    if (typeof client.signInWithOauthConnection !== "function") {
      console.error("Instance missing signInWithOauthConnection");
      process.exit(1);
    }

    // Bundle-level regression for the 2.3.0 logout bug: the published CJS is
    // ES5, where subclassing Error breaks the prototype chain — an instanceof
    // guard that passes in vitest (modern compile of the source) is FALSE at
    // runtime in the bundle. So the "keep the session on a server-returned
    // error redirect" contract must be verified against the PACKED build.
    const { FaableAuthClient } = mod;
    const ERROR_URL = "https://app.example.com/page?error=access_denied&error_description=denied";
    const seededStorage = () => {
      const store = new Map();
      store.set("faableauth-test-client", JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "Bearer", expires_at: Math.floor(Date.now() / 1000) + 9999999, user: { id: "u" } }));
      const spy = { removed: false };
      return { spy, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => { spy.removed = true; store.delete(k); } } };
    };

    // 1) Single client (the real app shape): seed a session, initialize on a
    //    URL carrying ?error=..., assert the session survives in storage and
    //    getRedirectError() surfaces the motive, consume-once.
    loc.href = ERROR_URL;
    {
      const { spy, storage } = seededStorage();
      const auth = new FaableAuthClient({ domain: "https://t.auth.faable.link", clientId: "test-client", storage, autoRefreshToken: false });
      const { error } = await auth.initialize();
      const { data } = await auth.getSession();
      const redirectError = await auth.getRedirectError();
      if (!error || error.name !== "AuthImplicitGrantRedirectError") {
        console.error("Expected the redirect error from initialize(), got:", error && error.name);
        process.exit(1);
      }
      if (spy.removed || !data.session) {
        console.error("A server-returned error redirect must NOT log the user out (removed:", spy.removed, "session:", !!data.session, ")");
        process.exit(1);
      }
      if (!redirectError || redirectError.error !== "access_denied") {
        console.error("getRedirectError() must surface the redirect error, got:", JSON.stringify(redirectError));
        process.exit(1);
      }
      if ((await auth.getRedirectError()) !== null) {
        console.error("getRedirectError() must be consume-once");
        process.exit(1);
      }
    }

    // 2) Two clients racing on the same page: the first consumes and strips
    //    the params; the second re-parses an already-clean URL. Neither may
    //    remove the stored session (the second used to fall into the legacy
    //    "failed implicit login" removal).
    loc.href = ERROR_URL;
    {
      const a = seededStorage();
      const b = seededStorage();
      const authA = new FaableAuthClient({ domain: "https://t.auth.faable.link", clientId: "test-client", storage: a.storage, autoRefreshToken: false });
      const authB = new FaableAuthClient({ domain: "https://t.auth.faable.link", clientId: "test-client", storage: b.storage, autoRefreshToken: false });
      await Promise.all([authA.initialize(), authB.initialize()]);
      const [sa, sb] = [await authA.getSession(), await authB.getSession()];
      if (a.spy.removed || b.spy.removed || !sa.data.session || !sb.data.session) {
        console.error("Racing clients must not log each other out (removedA:", a.spy.removed, "removedB:", b.spy.removed, "sessionA:", !!sa.data.session, "sessionB:", !!sb.data.session, ")");
        process.exit(1);
      }
    }
    console.log("ok");
    // Initialized clients leave live handles (broadcast/lock plumbing) that
    // keep the node process alive — exit explicitly once assertions pass.
    process.exit(0);
  `
  writeFileSync(join(tmp, 'probe.mjs'), probe)
  const out = capture('node probe.mjs', { cwd: tmp })
  if (out !== 'ok') {
    console.error(`Probe failed: ${out}`)
    process.exit(1)
  }

  console.log('✓ Pack verify passed')
  rmSync(tarballPath, { force: true })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
