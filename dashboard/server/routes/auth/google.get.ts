/**
 * GET /auth/google — Google OAuth callback + login initiation.
 *
 * Register `<origin>/auth/google` as an authorized redirect URI in the Google
 * Cloud console and set NUXT_OAUTH_GOOGLE_CLIENT_ID /
 * NUXT_OAUTH_GOOGLE_CLIENT_SECRET.
 */

import { findOrCreateOAuthUser, toSessionUser } from '../../utils/auth'

export default defineOAuthGoogleEventHandler({
  config: {
    scope: ['openid', 'email', 'profile'],
  },
  async onSuccess(event, { user }) {
    const record = await findOrCreateOAuthUser({
      provider: 'google',
      providerAccountId: user.sub,
      email: user.email,
      name: user.name,
      avatarUrl: user.picture,
    })

    await setUserSession(event, {
      user: toSessionUser(record, 'google'),
      loggedInAt: new Date().toISOString(),
    })

    return sendRedirect(event, '/dashboard')
  },
  onError(event, error) {
    console.error('[auth] Google OAuth error:', error)
    return sendRedirect(event, '/login?error=google')
  },
})
