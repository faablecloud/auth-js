import type { SessionStore } from './types'

/**
 * The default {@link SessionStore}: a map in this process's memory. Correct
 * for a single instance; with several, a back-channel logout received by one
 * is unknown to the others — use a shared store there.
 */
export const memorySessionStore = (): SessionStore => {
  const sids = new Map<string, number>() // sid -> exp
  const subs = new Map<string, { iat: number; exp: number }>() // sub -> before iat

  const sweep = (now: number) => {
    sids.forEach((exp, sid) => {
      if (exp <= now) sids.delete(sid)
    })
    subs.forEach((r, sub) => {
      if (r.exp <= now) subs.delete(sub)
    })
  }

  return {
    revoke({ sid, sub, iat, exp }) {
      sweep(Math.floor(Date.now() / 1000))
      if (sid) sids.set(sid, exp)
      // Without a sid the token ends every session of the user that existed
      // when it was issued: remember the cut-off.
      else if (sub) {
        const prev = subs.get(sub)
        subs.set(sub, {
          iat: Math.max(iat, prev?.iat ?? 0),
          exp: Math.max(exp, prev?.exp ?? 0)
        })
      }
    },
    isRevoked({ sid, sub, iat }) {
      const now = Math.floor(Date.now() / 1000)
      if (sid && (sids.get(sid) ?? 0) > now) return true
      const cut = subs.get(sub)
      return !!cut && cut.exp > now && iat <= cut.iat
    }
  }
}
