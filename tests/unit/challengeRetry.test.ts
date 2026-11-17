import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '../../src/createClient'
import { _post } from '../../src/lib/fetch'
import type { SupportedStorage } from '../../src/lib/types'

vi.mock('../../src/lib/fetch', () => ({
  _post: vi.fn(),
  _get: vi.fn(async () => ({ data: null, error: null }))
}))

const mPost = _post as unknown as ReturnType<typeof vi.fn>

const storage = (): SupportedStorage => {
  const m = new Map<string, string>()
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: k => void m.delete(k)
  }
}

const client = () =>
  createClient({
    domain: 'https://tenant.auth.faable.link',
    clientId: 'test-client',
    storage: storage(),
    autoRefreshToken: false as const
  })

const challenge = {
  id: 'ch_1',
  kind: 'pow',
  seed: '0123456789abcdef0123456789abcdef',
  email_hash: createHash('sha256').update('laura@ejemplo.com').digest('hex'),
  difficulty: 10,
  expires_at: new Date(Date.now() + 300_000).toISOString()
}

const challengeRequired = {
  data: {
    error_code: 'challenge_required',
    message: 'solve the challenge and retry',
    details: challenge
  },
  error: 'solve the challenge and retry',
  status: 428,
  code: 'challenge_required'
}

const accepted = (
  seed: string,
  email_hash: string,
  nonce: string,
  bits: number
) => {
  const d = createHash('sha256')
    .update(`${seed}:${email_hash}:${nonce}`)
    .digest()
  let z = 0
  for (const b of d) {
    if (b === 0) {
      z += 8
      continue
    }
    z += Math.clz32(b) - 24
    break
  }
  return z >= bits
}

beforeEach(() => {
  mPost.mockReset()
})

describe('challenge: signup()', () => {
  it('solves the challenge and retries once, transparently', async () => {
    const states: string[] = []
    mPost.mockResolvedValueOnce(challengeRequired).mockResolvedValueOnce({
      data: { status: 'created', user_id: 'user_1', email_verified: false },
      error: null,
      status: 200
    })
    const { data, error } = await client().signup({
      email: 'laura@ejemplo.com',
      onChallenge: s => states.push(s)
    })
    expect(error).toBeNull()
    expect(data?.user_id).toBe('user_1')
    expect(mPost).toHaveBeenCalledTimes(2)
    const retryBody = mPost.mock.calls[1][1]
    expect(retryBody.challenge.id).toBe('ch_1')
    expect(
      accepted(
        challenge.seed,
        challenge.email_hash,
        retryBody.challenge.nonce,
        10
      )
    ).toBe(true)
    expect(states).toEqual(['solving', 'done'])
  })

  it('does not loop: a second challenge comes back as an error', async () => {
    mPost.mockResolvedValueOnce(challengeRequired).mockResolvedValueOnce({
      ...challengeRequired,
      code: 'challenge_invalid'
    })
    const { error } = await client().signup({ email: 'laura@ejemplo.com' })
    expect(mPost).toHaveBeenCalledTimes(2)
    expect(error?.code).toBe('challenge_invalid')
  })

  it('keeps the server code on a 403 instead of signup_disabled', async () => {
    mPost.mockResolvedValueOnce({
      data: { error_code: 'challenge_unsupported' },
      error: 'This application requires @faable/auth-js >= 3.4.0 to sign up',
      status: 403,
      code: 'challenge_unsupported'
    })
    const { error } = await client().signup({ email: 'laura@ejemplo.com' })
    expect(error?.code).toBe('challenge_unsupported')
  })
})

describe('challenge: signInWithPasswordless()', () => {
  it('solves and retries, then remembers the pending code', async () => {
    mPost.mockResolvedValueOnce(challengeRequired).mockResolvedValueOnce({
      data: { email: 'laura@ejemplo.com' },
      error: null
    })
    const { error } = await client().signInWithPasswordless({
      email: 'laura@ejemplo.com',
      type: 'code'
    })
    expect(error).toBeNull()
    expect(mPost.mock.calls[1][1].challenge.id).toBe('ch_1')
  })

  it('returns an AuthApiError with the server code, not a bare string', async () => {
    mPost.mockResolvedValueOnce({
      data: { error_code: 'origin_required' },
      error: 'This application only accepts this request from a browser',
      status: 403,
      code: 'origin_required'
    })
    const { error } = await client().signInWithPasswordless({
      email: 'laura@ejemplo.com',
      type: 'code'
    })
    expect(error?.code).toBe('origin_required')
    expect(error?.message).toContain('browser')
  })
})
