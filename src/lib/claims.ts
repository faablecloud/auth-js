// Reading authorization claims of a decoded access token. Decoded, not
// verified: good for UI and routing, never as authorization — the resource
// server verifies the token (e.g. `verifyAccessToken` in @faable/auth-sdk).

type WithPermissions = { permissions?: string | string[] } | null | undefined
type WithRoles = { roles?: string[] } | null | undefined

const asList = (value: string | string[]) =>
  Array.isArray(value) ? value : [value]

/**
 * The permissions of a token, as a list. Faable Auth emits the claim as a
 * space-separated string (`access_token_authz` dialect); an array is accepted
 * too.
 */
export const permissionsOf = (claims: WithPermissions): string[] => {
  const raw = claims?.permissions as unknown
  if (Array.isArray(raw)) return raw.filter(p => typeof p === 'string')
  if (typeof raw === 'string') return raw.split(' ').filter(Boolean)
  return []
}

/** True when the claims carry EVERY permission in `required`. */
export const hasPermissions = (
  claims: WithPermissions,
  required: string | string[]
): boolean => {
  const held = new Set(permissionsOf(claims))
  return asList(required).every(p => held.has(p))
}

/** True when the claims carry EVERY role name in `required`. */
export const hasRoles = (
  claims: WithRoles,
  required: string | string[]
): boolean => {
  const held = new Set(Array.isArray(claims?.roles) ? claims.roles : [])
  return asList(required).every(r => held.has(r))
}
