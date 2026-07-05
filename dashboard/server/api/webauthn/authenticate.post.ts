/**
 * POST /api/webauthn/authenticate — passkey login.
 *
 * Two-step protocol driven by `useWebAuthn().authenticate()`:
 *   1. { userName? }            → server returns assertion options + challenge
 *   2. { attemptId, response }  → server verifies the assertion, bumps the
 *                                 credential's signature counter and opens a
 *                                 session.
 *
 * `userName` is optional: with it we scope `allowCredentials` to that account;
 * without it the browser offers any discoverable passkey for this origin.
 */

import {
  getCredentialById,
  getUserById,
  getUserCredentials,
  findUserByEmail,
  toSessionUser,
  updateCredentialCounter,
} from '../../utils/auth'

const challenges = () => useStorage('webauthn')

export default defineWebAuthnAuthenticateEventHandler({
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
  async allowCredentials(_event, userName) {
    const user = await findUserByEmail(userName)
    if (!user) return []
    const creds = await getUserCredentials(user.id)
    return creds.map((c) => ({ id: c.id, transports: JSON.parse(c.transports) }))
  },
  async getCredential(_event, credentialId) {
    const credential = await getCredentialById(credentialId)
    if (!credential) {
      throw createError({ statusCode: 400, statusMessage: 'Unknown credential' })
    }
    return {
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      backedUp: credential.backedUp,
      transports: JSON.parse(credential.transports),
      // Extra field — carried through to onSuccess to resolve the session user.
      userId: credential.userId,
    }
  },
  async onSuccess(event, { credential, authenticationInfo }) {
    await updateCredentialCounter(credential.id, authenticationInfo.newCounter)

    const user = await getUserById(credential.userId as number)
    if (!user) {
      throw createError({ statusCode: 401, statusMessage: 'Account no longer exists' })
    }

    await setUserSession(event, {
      user: toSessionUser(user, 'webauthn'),
      loggedInAt: new Date().toISOString(),
    })
  },
})
