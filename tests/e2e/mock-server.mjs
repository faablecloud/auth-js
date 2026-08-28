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
    otps: new Map(), // username -> otp
    audiences: { authorize: [], token: [] }, // audience values seen per endpoint
    // Forces the next /oauth/token call to fail with an exact status + body,
    // so tests can assert that a real server refusal (an action deny, a rate
    // limit) reaches the caller verbatim instead of being flattened into a
    // generic "session missing".
    tokenFailure: null,
    // Every POST /oauth/link_ticket the SDK made: which bearer it sent and
    // which ticket came back. Lets the link spec prove the ticket in the
    // /authorize URL is the one minted for THIS session's access token.
    linkTickets: [],
    // Forces POST /oauth/link_ticket to answer with this status (e.g. 404 for
    // a server that predates the endpoint).
    linkTicketFailure: null
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

  app.post('/__seed/link_ticket_failure', (req, res) => {
    const { status, body } = req.body
    state.linkTicketFailure = { status, body }
    res.json({ ok: true })
  })

  app.post('/__seed/token_failure', (req, res) => {
    const { status, body } = req.body
    state.tokenFailure = { status, body }
    res.json({ ok: true })
  })

  app.get('/__state', (_req, res) => {
    res.json({
      pkce: [...state.pkce.entries()],
      sessions: [...state.sessions.keys()],
      refreshables: [...state.refreshables.keys()],
      otps: [...state.otps.entries()],
      audiences: state.audiences,
      linkTickets: state.linkTickets
    })
  })

  // ---- Auth endpoints ------------------------------------------------------
  app.get('/authorize', (req, res) => {
    // PKCE happy path: emit a code and bounce back to redirect_uri with it.
    const {
      redirect_uri,
      code_challenge,
      response_type,
      state: oauthState,
      audience
    } = req.query
    if (!redirect_uri) return res.status(400).send('Missing redirect_uri')
    state.audiences.authorize.push(audience ?? null)
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

  // RFC 6749 §5.2 is what the real /oauth/token speaks: `{ error }`, with an
  // optional `error_description`. It never sends `message` — the shape the rest
  // of the API uses. Mirroring that here is the point: a mock that answered
  // `{ message }` let auth-js look like it read the reason when in production
  // it could not see it at all.
  const oauthError = (res, status, error, error_description) =>
    res
      .status(status)
      .json({ error, ...(error_description ? { error_description } : {}) })

  app.post('/oauth/token', (req, res) => {
    const {
      grant_type,
      code,
      code_verifier,
      refresh_token,
      username,
      otp,
      audience
    } = req.body
    state.audiences.token.push({ grant_type, audience: audience ?? null })

    if (state.tokenFailure) {
      const { status, body } = state.tokenFailure
      state.tokenFailure = null
      return res.status(status).json(body)
    }

    if (grant_type === 'authorization_code') {
      const stored = state.pkce.get(code)
      if (!stored) return oauthError(res, 400, 'invalid_code')
      if (
        stored.code_challenge &&
        sha256base64url(code_verifier) !== stored.code_challenge
      ) {
        return oauthError(res, 400, 'bad_code_verifier')
      }
      state.pkce.delete(code)
      return res.json(
        issueSession({ sub: 'pkce-user', email: 'pkce@example.com' })
      )
    }

    if (grant_type === 'refresh_token') {
      const user = state.refreshables.get(refresh_token)
      if (!user) {
        return oauthError(res, 400, 'invalid_refresh_token')
      }
      state.refreshables.delete(refresh_token)
      return res.json(issueSession(user))
    }

    if (grant_type === 'http://auth0.com/oauth/grant-type/passwordless/otp') {
      const expected = state.otps.get(username)
      if (!expected || expected !== otp) {
        return oauthError(res, 400, 'Invalid or expired OTP')
      }
      state.otps.delete(username)
      return res.json(issueSession({ sub: 'otp-user', email: username }))
    }

    oauthError(res, 400, 'unsupported_grant_type')
  })

  // Link-mode session bootstrap (arch/auth/link-mode-session-ticket.md):
  // trades a valid Bearer for a single-use ticket the SDK appends to
  // /authorize?link=true. Records the exchange so the spec can match the
  // ticket in the URL against the bearer that minted it.
  app.post('/oauth/link_ticket', (req, res) => {
    if (state.linkTicketFailure) {
      const { status, body } = state.linkTicketFailure
      state.linkTicketFailure = null
      return res.status(status).json(body)
    }
    const auth = req.header('authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const user = state.sessions.get(token)
    if (!user) return res.status(401).json({ message: 'no_authorization' })
    const link_ticket = randomString('lt_')
    state.linkTickets.push({ bearer: token, link_ticket })
    res.json({ link_ticket, expires_in: 60 })
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
