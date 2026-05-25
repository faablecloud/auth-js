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
    import * as mod from "@faable/auth-js";

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
    console.log("ok");
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
