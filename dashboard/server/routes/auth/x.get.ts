/**
 * GET /auth/x — X (Twitter) OAuth 2.0 callback + login initiation.
 *
 * Uses the OAuth 2.0 Authorization Code flow with PKCE (handled by the module).
 * Register `<origin>/auth/x` as a callback URL on your X app and set
 * NUXT_OAUTH_X_CLIENT_ID / NUXT_OAUTH_X_CLIENT_SECRET.
 *
 * X does not expose an email address through `users/me`, so identity is anchored
 * on the numeric account id and the session carries a null email.
 */

import { findOrCreateOAuthUser, toSessionUser } from '../../utils/auth'

export default defineOAuthXEventHandler({
  config: {
    scope: ['users.read', 'tweet.read'],
    // Ask for the avatar; `users/me` omits it unless requested via user.fields.
    userURL: 'https://api.x.com/2/users/me?user.fields=profile_image_url',
  },
  async onSuccess(event, { user }) {
    const record = await findOrCreateOAuthUser({
      provider: 'x',
      providerAccountId: String(user.id),
      email: null,
      name: user.name || user.username,
      avatarUrl: user.profile_image_url ?? null,
    })

    await setUserSession(event, {
      user: toSessionUser(record, 'x'),
      loggedInAt: new Date().toISOString(),
    })

    return sendRedirect(event, '/')
  },
  onError(event, error) {
    console.error('[auth] X OAuth error:', error)
    return sendRedirect(event, '/login?error=x')
  },
})
