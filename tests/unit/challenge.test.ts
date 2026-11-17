import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  __workerKernelSource,
  sha256Hex,
  solveChallenge
} from '../../src/lib/challenge'

const nodeSha = (s: string) => createHash('sha256').update(s).digest('hex')

// The Worker's kernel, run in Node exactly as the Worker would run it.
const workerKernel = new Function(
  `${__workerKernelSource}; return { sha256ascii: sha256ascii, leadingZeroBits: leadingZeroBits };`
)() as {
  sha256ascii: (s: string) => Uint32Array
  leadingZeroBits: (h: Uint32Array) => number
}
const workerHex = (s: string) =>
  Array.from(workerKernel.sha256ascii(s))
    .map(w => (w >>> 0).toString(16).padStart(8, '0'))
    .join('')

// The server's check (auth src/lib/signup_challenge.ts), byte for byte.
const serverAccepts = (
  seed: string,
  email_hash: string,
  nonce: string,
  difficulty: number
) => {
  const d = createHash('sha256')
    .update(`${seed}:${email_hash}:${nonce}`)
    .digest()
  let bits = 0
  for (const byte of d) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += Math.clz32(byte) - 24
    break
  }
  return bits >= difficulty
}

describe('challenge sha256', () => {
  const inputs = [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'a'.repeat(119),
    `${'f'.repeat(32)}:${'0'.repeat(64)}:zz9`
  ]
  it.each(inputs)('page kernel matches node:crypto (%#)', input => {
    expect(sha256Hex(input)).toBe(nodeSha(input))
  })
  it.each(inputs)('worker kernel matches node:crypto (%#)', input => {
    expect(workerHex(input)).toBe(nodeSha(input))
  })
})

describe('solveChallenge', () => {
  it('finds a nonce the server accepts', async () => {
    const c = {
      id: 'c1',
      kind: 'pow' as const,
      seed: '9f86d081884c7d659a2feaa0c55ad015',
      email_hash: createHash('sha256')
        .update('laura@ejemplo.com')
        .digest('hex'),
      difficulty: 14,
      expires_at: new Date(Date.now() + 300_000).toISOString()
    }
    const progress: number[] = []
    const nonce = await solveChallenge(c, { onProgress: p => progress.push(p) })
    expect(serverAccepts(c.seed, c.email_hash, nonce, c.difficulty)).toBe(true)
  })

  it('stops when aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      solveChallenge(
        {
          id: 'c2',
          kind: 'pow',
          seed: 'aa',
          email_hash: 'bb',
          difficulty: 40,
          expires_at: ''
        },
        { signal: ac.signal }
      )
    ).rejects.toThrow(/Abort/)
  })
})
