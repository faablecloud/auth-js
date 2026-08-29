// Replaced at release time by the `semantic-release-replace-plugin` entry in
// `.releaserc`, which rewrites every `0.0.0-dev` in `pkg/dist/*.js` with the
// version being published.
//
// The sentinel MUST stay byte-identical to the `from` in `.releaserc` (and to
// the `version` in package.json, which produces the same string in the rollup
// banner). It read `0.0.0` until 2026-08-29, so the replacement only ever hit
// the banner comment and every published build reported `auth-js/0.0.0` on the
// wire — see `.releaserc` for the guard that now fails the release instead.
export const version = '0.0.0-dev'
