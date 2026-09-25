// The helper imports these lazily and only when the caller did not hand in a
// Request. `next` is a peer of the consuming app, not a dependency of this
// package, so the types are declared here instead of installed.
declare module 'next/headers' {
  export function cookies(): any
}
declare module 'next/server' {
  export const NextResponse: any
}
