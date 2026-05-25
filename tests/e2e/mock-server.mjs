// Mock Faable Auth backend for e2e tests. Serves the auth endpoints the SDK
// hits and also the static fixtures + the built bundle so everything is
// same-origin (no CORS dance).
import express from 'express'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// In-memory state for a single test run. Each test starts with an empty bag
// (the suite calls POST /__reset between tests).
let state = freshState()

function freshState() {
  return {
    pkce: new Map(), // code -> { code_challenge }
    sessions: new Map(), // access_token -> user
    refreshables: new Map(), // refresh_token -> user
    otps: new Map() // username -> otp
  }
}

function randomString(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 12)
}

function sha256base64url(input) {
  return createHash('sha256')
    .update(input)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function issueSession(user) {
  const access_token = randomString('at_')
  const refresh_token = randomString('rt_')
  state.sessions.set(access_token, user)
  state.refreshables.set(refresh_token, user)
  return {
    access_token,
    refresh_token,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user
  }
}

export function createMockServer() {
  const app = express()

  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))

  // ---- Test-only control endpoints ----------------------------------------
  app.post('/__reset', (_req, res) => {
    state = freshState()
    res.json({ ok: true })
  })

  app.post('/__seed/pkce', (req, res) => {
    const { code, code_challenge } = req.body
    state.pkce.set(code, { code_challenge })
    res.json({ ok: true })
  })

  app.post('/__seed/otp', (req, res) => {
    const { username, otp } = req.body
    state.otps.set(username, otp)
    res.json({ ok: true })
  })

  app.get('/__state', (_req, res) => {
    res.json({
      pkce: [...state.pkce.entries()],
      sessions: [...state.sessions.keys()],
      refreshables: [...state.refreshables.keys()],
      otps: [...state.otps.entries()]
    })
  })

  // ---- Auth endpoints ------------------------------------------------------
  app.get('/authorize', (req, res) => {
    // PKCE happy path: emit a code and bounce back to redirect_uri with it.
    const {
      redirect_uri,
      code_challenge,
      response_type,
      state: oauthState
    } = req.query
    if (!redirect_uri) return res.status(400).send('Missing redirect_uri')
    if (response_type === 'code') {
      const code = randomString('code_')
      if (code_challenge) state.pkce.set(code, { code_challenge })
      const url = new URL(redirect_uri)
      url.searchParams.set('code', code)
      if (oauthState) url.searchParams.set('state', oauthState)
      return res.redirect(url.toString())
    }
    // Implicit fallback
    const session = issueSession({
      sub: 'mock-user',
      email: 'mock@example.com'
    })
    const url = new URL(redirect_uri)
    url.hash =
      `access_token=${session.access_token}` +
      `&refresh_token=${session.refresh_token}` +
      `&expires_in=${session.expires_in}` +
      `&token_type=${session.token_type}`
    res.redirect(url.toString())
  })

  app.post('/oauth/token', (req, res) => {
    const { grant_type, code, code_verifier, refresh_token, username, otp } =
      req.body

    if (grant_type === 'authorization_code') {
      const stored = state.pkce.get(code)
      if (!stored) return res.status(400).json({ message: 'invalid_code' })
      if (
        stored.code_challenge &&
        sha256base64url(code_verifier) !== stored.code_challenge
      ) {
        return res.status(400).json({ message: 'bad_code_verifier' })
      }
      state.pkce.delete(code)
      return res.json(
        issueSession({ sub: 'pkce-user', email: 'pkce@example.com' })
      )
    }

    if (grant_type === 'refresh_token') {
      const user = state.refreshables.get(refresh_token)
      if (!user) {
        return res.status(400).json({ message: 'invalid_refresh_token' })
      }
      state.refreshables.delete(refresh_token)
      return res.json(issueSession(user))
    }

    if (grant_type === 'http://auth0.com/oauth/grant-type/passwordless/otp') {
      const expected = state.otps.get(username)
      if (!expected || expected !== otp) {
        return res.status(400).json({ message: 'invalid_otp' })
      }
      state.otps.delete(username)
      return res.json(issueSession({ sub: 'otp-user', email: username }))
    }

    res.status(400).json({ message: 'unsupported_grant_type' })
  })

  app.get('/me', (req, res) => {
    const auth = req.header('authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const user = state.sessions.get(token)
    if (!user) return res.status(401).json({ message: 'no_authorization' })
    res.json(user)
  })

  app.post('/passwordless/start', (req, res) => {
    res.json({ email: req.body.email, sent: true })
  })

  app.post('/usernamepassword/login', (req, res) => {
    // The real backend returns an HTML form that posts back to /callback.
    res
      .type('html')
      .send(
        `<form id="form" action="${req.body.redirect_uri}" method="post">` +
          `<input name="state" value="${req.body.state || ''}"></form>`
      )
  })

  app.post('/dbconnections/change_password', (req, res) => {
    res.json({ email: req.body.email, queued: true })
  })

  app.get('/logout', (_req, res) => {
    res.json({ ok: true })
  })

  // ---- Static fixtures and the built bundle --------------------------------
  app.use('/pkg', express.static(resolve(ROOT, 'pkg')))
  app.use('/examples', express.static(resolve(ROOT, 'examples')))
  app.use(express.static(resolve(__dirname, 'fixtures')))

  return app
}

// Allow running directly: `node tests/e2e/mock-server.mjs`
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('mock-server.mjs')
) {
  const port = Number(process.env.PORT || 8082)
  if (!existsSync(resolve(ROOT, 'pkg/dist/faableauth.js'))) {
    console.error(
      'pkg/dist/faableauth.js missing — run `npm run build` before starting the mock server.'
    )
    process.exit(1)
  }
  createMockServer().listen(port, () => {
    console.warn(`mock auth server listening on http://localhost:${port}`)
  })
}
