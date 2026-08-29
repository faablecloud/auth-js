// Both constants are replaced at release time by the
// `semantic-release-replace-plugin` entries in `.releaserc`, which rewrite
// every occurrence in `pkg/dist/*.js` with the version and commit being
// published.
//
// The sentinels MUST stay byte-identical to the `from` values in `.releaserc`.
// `version` read `0.0.0` until 2026-08-29, so the replacement only ever hit
// the rollup banner and every published build reported `auth-js/0.0.0` on the
// wire — see `tests/pack/verify-pack.mjs` for the guard that now fails the
// build instead of shipping an anonymous client.
export const version = '0.0.0-dev'

// Short git SHA of the released commit. The version alone dates a build; this
// names the exact tree, which is what you need to go from a canonical log line
// or an audit entry straight to `git show <sha>`.
//
// Deliberately NOT hex, so an unreleased build (dev, a local link, a fork)
// cannot be mistaken for a real commit: the server only records values that
// look like a SHA, and this one never will.
export const commit = '0000000dev'
