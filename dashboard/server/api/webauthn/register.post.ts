/**
 * POST /api/webauthn/register — passkey registration.
 *
 * Two-step protocol driven by `useWebAuthn().register()`:
 *   1. { user } only            → server returns registration options + challenge
 *   2. { user, attemptId, ... } → server verifies the attestation, stores the
 *                                 credential and opens a session.
 *
 * The challenge is held in Nitro storage between the two calls, keyed by an
 * opaque attemptId, and consumed exactly once.
 */

import {
  createWebauthnUser,
  findUserByEmail,
  getUserCredentials,
  saveCredential,
  toSessionUser,
} from '../../utils/auth'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const challenges = () => useStorage('webauthn')

export default defineWebAuthnRegisterEventHandler({
  async storeChallenge(_event, challenge, attemptId) {
    await challenges().setItem(`challenge:${attemptId}`, challenge)
  },
  async getChallenge(_event, attemptId) {
    const key = `challenge:${attemptId}`
    const challenge = await challenges().getItem<string>(key)
    await challenges().removeItem(key)
    if (!challenge) {
      throw createError({ statusCode: 400, statusMessage: 'Challenge expired, please retry' })
    }
    return challenge
  },
  // The `userName` is the identity the passkey is registered against. We treat
  // it as an email so the same account can also log in via an OAuth provider.
  async validateUser(userBody) {
    const userName = String(userBody.userName ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(userName)) {
      throw createError({ statusCode: 400, statusMessage: 'A valid email address is required' })
    }
    return { userName, displayName: userBody.displayName }
  },
  // Prevent the same authenticator from being enrolled twice for one account.
  async excludeCredentials(_event, userName) {
    const user = await findUserByEmail(userName)
    if (!user) return []
    const creds = await getUserCredentials(user.id)
    return creds.map((c) => ({ id: c.id, transports: JSON.parse(c.transports) }))
  },
  async onSuccess(event, { user, credential }) {
    const record =
      (await findUserByEmail(user.userName)) ??
      (await createWebauthnUser(user.userName, user.displayName))

    await saveCredential({
      id: credential.id,
      userId: record.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      backedUp: credential.backedUp,
      transports: credential.transports,
    })

    await setUserSession(event, {
      user: toSessionUser(record, 'webauthn'),
      loggedInAt: new Date().toISOString(),
    })
  },
})
