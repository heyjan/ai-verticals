// Type augmentation for nuxt-auth-utils. Shapes the data stored in the sealed
// session cookie and returned by `useUserSession()` / `getUserSession()`.
// Keep `User` small — the whole session is encrypted into a cookie with a
// ~4096-byte limit.
declare module '#auth-utils' {
  interface User {
    id: number
    name: string | null
    email: string | null
    avatarUrl: string | null
    /** How the current session was established. */
    provider: 'github' | 'google' | 'x' | 'linkedin' | 'webauthn'
  }

  interface UserSession {
    loggedInAt: string
  }

  // Nothing sensitive is kept server-side-only for now, but the interface must
  // exist for `secure` typing to resolve.
  interface SecureSessionData {}
}

export {}
