/**
 * GET /auth/linkedin — LinkedIn OAuth callback + login initiation.
 *
 * Uses LinkedIn's OpenID Connect flow ("Sign In with LinkedIn using OpenID
 * Connect" product). Register `<origin>/auth/linkedin` as an authorized
 * redirect URL and set NUXT_OAUTH_LINKEDIN_CLIENT_ID /
 * NUXT_OAUTH_LINKEDIN_CLIENT_SECRET.
 */

import { findOrCreateOAuthUser, toSessionUser } from '../../utils/auth'

export default defineOAuthLinkedInEventHandler({
  config: {
    scope: ['openid', 'profile', 'email'],
    emailRequired: true,
  },
  async onSuccess(event, { user }) {
    const record = await findOrCreateOAuthUser({
      provider: 'linkedin',
      providerAccountId: user.sub,
      email: user.email,
      name: user.name,
      avatarUrl: user.picture,
    })

    await setUserSession(event, {
      user: toSessionUser(record, 'linkedin'),
      loggedInAt: new Date().toISOString(),
    })

    return sendRedirect(event, '/')
  },
  onError(event, error) {
    console.error('[auth] LinkedIn OAuth error:', error)
    return sendRedirect(event, '/login?error=linkedin')
  },
})
