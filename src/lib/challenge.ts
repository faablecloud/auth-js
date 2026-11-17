/**
 * Proof-of-work challenge for signups and passwordless codes.
 *
 * When a client's signup protection asks for it, Faable Auth answers
 * `/passwordless/start` or `/dbconnections/signup` with `428
 * challenge_required` and a challenge in `details`. The library finds a
 * `nonce` such that sha256(`${seed}:${email_hash}:${nonce}`) starts with
 * `difficulty` zero bits and repeats the request with `challenge: { id, nonce }`.
 *
 * The format is a contract with the server (auth `src/lib/signup_challenge.ts`):
 * change one, change both.
 *
 * The search runs in a Web Worker when there is one, so the page never
 * freezes, and in the main thread in yielding batches when there is not (SSR,
 * a CSP that forbids blob: workers). SHA-256 is implemented here, synchronous:
 * `crypto.subtle.digest` is a promise per hash, and a million of them is
 * several times slower than doing the work inline.
 */

export type ChallengeDetails = {
  id: string
  kind: 'pow'
  seed: string
  email_hash: string
  difficulty: number
  expires_at: string
}

export type ChallengeState = 'solving' | 'done' | 'error'

export type SolveOptions = {
  signal?: AbortSignal
  /** Fraction of the expected work done so far (can exceed 1: it is luck). */
  onProgress?: (fraction: number) => void
}

export const isChallengeDetails = (
  value: unknown
): value is ChallengeDetails => {
  const v = value as Record<string, unknown> | null
  return (
    !!v &&
    v.kind === 'pow' &&
    typeof v.id === 'string' &&
    typeof v.seed === 'string' &&
    typeof v.email_hash === 'string' &&
    typeof v.difficulty === 'number'
  )
}

// ── SHA-256 (FIPS 180-4), synchronous, for ASCII input ──────────────────────
// Kept as a source string too: the Worker is built from it (see WORKER_SRC).

const SHA256_SRC = `
var K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
var W = new Uint32Array(64);
var H = new Uint32Array(8);
var BUF = new Uint8Array(256);
function sha256ascii(str) {
  var len = str.length;
  var blocks = ((len + 9 + 63) >> 6);
  var total = blocks << 6;
  var buf = total <= 256 ? BUF : new Uint8Array(total);
  for (var i = 0; i < total; i++) buf[i] = 0;
  for (var i = 0; i < len; i++) buf[i] = str.charCodeAt(i) & 0xff;
  buf[len] = 0x80;
  var bits = len * 8;
  buf[total - 4] = (bits >>> 24) & 0xff;
  buf[total - 3] = (bits >>> 16) & 0xff;
  buf[total - 2] = (bits >>> 8) & 0xff;
  buf[total - 1] = bits & 0xff;
  H[0]=0x6a09e667;H[1]=0xbb67ae85;H[2]=0x3c6ef372;H[3]=0xa54ff53a;
  H[4]=0x510e527f;H[5]=0x9b05688c;H[6]=0x1f83d9ab;H[7]=0x5be0cd19;
  for (var off = 0; off < total; off += 64) {
    for (var t = 0; t < 16; t++) {
      var j = off + t * 4;
      W[t] = (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3];
    }
    for (var t = 16; t < 64; t++) {
      var w15 = W[t - 15], w2 = W[t - 2];
      var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (var t = 0; t < 64; t++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K[t] + W[t]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var mj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0]=(H[0]+a)|0;H[1]=(H[1]+b)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0;
  }
  return H;
}
function leadingZeroBits(h) {
  var bits = 0;
  for (var i = 0; i < 8; i++) {
    if (h[i] === 0) { bits += 32; continue; }
    return bits + Math.clz32(h[i]);
  }
  return bits;
}
function searchBatch(prefix, start, count, difficulty) {
  for (var n = start; n < start + count; n++) {
    var nonce = n.toString(36);
    if (leadingZeroBits(sha256ascii(prefix + nonce)) >= difficulty) return nonce;
  }
  return null;
}
`

// The same kernel as TypeScript, for the main-thread path: no `new Function`
// (a CSP without 'unsafe-eval' would block it). Tests check both against
// node:crypto so they cannot drift apart.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])
const W = new Uint32Array(64)
const H = new Uint32Array(8)

const BUF = new Uint8Array(256)

const sha256ascii = (str: string): Uint32Array => {
  const len = str.length
  const total = ((len + 9 + 63) >> 6) << 6
  // Reused across calls: a fresh array per hash is most of the cost.
  const buf = total <= BUF.length ? BUF : new Uint8Array(total)
  buf.fill(0, 0, total)
  for (let i = 0; i < len; i++) buf[i] = str.charCodeAt(i) & 0xff
  buf[len] = 0x80
  const bits = len * 8
  buf[total - 4] = (bits >>> 24) & 0xff
  buf[total - 3] = (bits >>> 16) & 0xff
  buf[total - 2] = (bits >>> 8) & 0xff
  buf[total - 1] = bits & 0xff
  H[0] = 0x6a09e667
  H[1] = 0xbb67ae85
  H[2] = 0x3c6ef372
  H[3] = 0xa54ff53a
  H[4] = 0x510e527f
  H[5] = 0x9b05688c
  H[6] = 0x1f83d9ab
  H[7] = 0x5be0cd19
  for (let off = 0; off < total; off += 64) {
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4
      W[t] =
        (buf[j] << 24) | (buf[j + 1] << 16) | (buf[j + 2] << 8) | buf[j + 3]
    }
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15]
      const w2 = W[t - 2]
      const s0 =
        ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
      const s1 =
        ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0
    }
    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3]
    let e = H[4],
      f = H[5],
      g = H[6],
      h = H[7]
    for (let t = 0; t < 64; t++) {
      const S1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[t] + W[t]) | 0
      const S0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10))
      const mj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + mj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    H[0] = (H[0] + a) | 0
    H[1] = (H[1] + b) | 0
    H[2] = (H[2] + c) | 0
    H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0
    H[5] = (H[5] + f) | 0
    H[6] = (H[6] + g) | 0
    H[7] = (H[7] + h) | 0
  }
  return H
}

const leadingZeroBits = (h: Uint32Array): number => {
  let bits = 0
  for (let i = 0; i < 8; i++) {
    if (h[i] === 0) {
      bits += 32
      continue
    }
    return bits + Math.clz32(h[i])
  }
  return bits
}

const searchBatch = (
  prefix: string,
  start: number,
  count: number,
  difficulty: number
): string | null => {
  for (let n = start; n < start + count; n++) {
    const nonce = n.toString(36)
    if (leadingZeroBits(sha256ascii(prefix + nonce)) >= difficulty) return nonce
  }
  return null
}

/** The Worker's source, exported only so the tests can run it in Node. */
export const __workerKernelSource = SHA256_SRC

/** Hex SHA-256 of an ASCII string. Exported for the tests. */
export const sha256Hex = (input: string): string =>
  Array.from(sha256ascii(input))
    .map(w => (w >>> 0).toString(16).padStart(8, '0'))
    .join('')

const BATCH = 50_000

const WORKER_SRC = `${SHA256_SRC}
onmessage = function (ev) {
  var d = ev.data, n = 0, expected = Math.pow(2, d.difficulty);
  for (;;) {
    var found = searchBatch(d.prefix, n, ${BATCH}, d.difficulty);
    if (found !== null) { postMessage({ nonce: found }); return; }
    n += ${BATCH};
    postMessage({ progress: n / expected });
  }
};`

const solveInWorker = (
  c: ChallengeDetails,
  opts: SolveOptions
): Promise<string> | null => {
  if (
    typeof Worker === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null
  }
  let url: string
  let worker: Worker
  try {
    url = URL.createObjectURL(
      new Blob([WORKER_SRC], { type: 'application/javascript' })
    )
    worker = new Worker(url)
  } catch {
    // A CSP without `worker-src blob:` lands here: fall back to the page.
    return null
  }
  return new Promise<string>((resolve, reject) => {
    const done = () => {
      worker.terminate()
      URL.revokeObjectURL(url)
    }
    opts.signal?.addEventListener('abort', () => {
      done()
      reject(new DOMException('Aborted', 'AbortError'))
    })
    worker.onmessage = ev => {
      const d = ev.data as { nonce?: string; progress?: number }
      if (typeof d.progress === 'number') opts.onProgress?.(d.progress)
      if (typeof d.nonce === 'string') {
        done()
        resolve(d.nonce)
      }
    }
    worker.onerror = ev => {
      done()
      reject(new Error(ev.message || 'challenge worker failed'))
    }
    worker.postMessage({
      prefix: `${c.seed}:${c.email_hash}:`,
      difficulty: c.difficulty
    })
  })
}

const solveInPage = async (
  c: ChallengeDetails,
  opts: SolveOptions
): Promise<string> => {
  const prefix = `${c.seed}:${c.email_hash}:`
  const expected = Math.pow(2, c.difficulty)
  for (let n = 0; ; n += BATCH) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const found = searchBatch(prefix, n, BATCH, c.difficulty)
    if (found !== null) return found
    opts.onProgress?.((n + BATCH) / expected)
    // Yield so the page keeps painting the spinner and handling input.
    await new Promise(r => setTimeout(r, 0))
  }
}

/** Finds the nonce for a challenge. Rejects with AbortError when aborted. */
export const solveChallenge = async (
  c: ChallengeDetails,
  opts: SolveOptions = {}
): Promise<string> => (await solveInWorker(c, opts)) ?? solveInPage(c, opts)

export const CHALLENGE_EVENT = 'faable-challenge'

/**
 * Tells whoever listens how the challenge is going: the `onChallenge`
 * callback of the call, and a `faable-challenge` CustomEvent on `window`
 * (`detail: { state }`) that the visible widget follows.
 */
const announce = (
  state: ChallengeState,
  onChallenge?: (state: ChallengeState) => void
) => {
  try {
    onChallenge?.(state)
  } catch {
    // A throwing callback must not break the sign-up.
  }
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent(CHALLENGE_EVENT, { detail: { state } })
    )
  }
}

type PostResult = {
  data?: unknown
  error?: unknown
  status?: number
  code?: string
}

/**
 * Sends a request and, if the server asks for a challenge, solves it and sends
 * it again — once. Used by `signup()` and `signInWithPasswordless()`.
 */
export const postWithChallenge = async <R extends PostResult>(
  send: (challenge?: { id: string; nonce: string }) => Promise<R>,
  onChallenge?: (state: ChallengeState) => void
): Promise<R> => {
  const first = await send()
  const details = (first.data as { details?: unknown } | null)?.details
  if (
    !first.error ||
    (first.code !== 'challenge_required' &&
      first.code !== 'challenge_invalid') ||
    !isChallengeDetails(details)
  ) {
    return first
  }
  announce('solving', onChallenge)
  let nonce: string
  try {
    nonce = await solveChallenge(details)
  } catch (e) {
    announce('error', onChallenge)
    throw e
  }
  const second = await send({ id: details.id, nonce })
  announce(second.error ? 'error' : 'done', onChallenge)
  return second
}
