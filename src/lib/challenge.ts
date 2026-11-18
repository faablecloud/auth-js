/**
 * Proof-of-work challenge for signups and passwordless codes.
 *
 * Since auth-js 3.7 the solver lives in `@faable/challenge` (Faable
 * Challenge's browser package, faablecloud/challenge-js), bundled here: one
 * implementation for Faable Auth's signups and for any form a Challenge site
 * protects. This module keeps auth-js's import paths and public names.
 *
 * When a client's signup protection asks for it, Faable Auth answers
 * `/passwordless/start` or `/dbconnections/signup` with `428
 * challenge_required` and a challenge in `details`; `postWithChallenge`
 * solves it and repeats the request with `challenge: { id, nonce }`.
 */
export {
  CHALLENGE_EVENT,
  isChallengeDetails,
  postWithChallenge,
  solveChallenge
} from '@faable/challenge'
export type {
  ChallengeDetails,
  ChallengeState,
  SolveOptions
} from '@faable/challenge'
