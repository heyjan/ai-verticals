/**
 * GET /auth/github — GitHub OAuth callback + login initiation.
 *
 * Register `<origin>/auth/github` as the OAuth App callback URL and set
 * NUXT_OAUTH_GITHUB_CLIENT_ID / NUXT_OAUTH_GITHUB_CLIENT_SECRET. Link a
 * "Sign in with GitHub" button to this route.
 */

import { findOrCreateOAuthUser, toSessionUser } from '../../utils/auth'

export default defineOAuthGitHubEventHandler({
  config: {
    emailRequired: true,
  },
  async onSuccess(event, { user }) {
    const record = await findOrCreateOAuthUser({
      provider: 'github',
      providerAccountId: String(user.id),
      email: user.email,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
    })

    await setUserSession(event, {
      user: toSessionUser(record, 'github'),
      loggedInAt: new Date().toISOString(),
    })

    return sendRedirect(event, '/')
  },
  onError(event, error) {
    console.error('[auth] GitHub OAuth error:', error)
    return sendRedirect(event, '/login?error=github')
  },
})
