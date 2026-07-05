/**
 * Auth persistence helpers shared by the OAuth callback routes and the WebAuthn
 * handlers. Everything that touches the `users`, `oauth_accounts` and
 * `webauthn_credentials` tables lives here so the route handlers stay thin.
 */

import {
  oauthAccounts,
  users,
  webauthnCredentials,
  type User,
} from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import { db } from './db'

export interface OAuthIdentity {
  provider: 'github' | 'google' | 'x' | 'linkedin'
  /** Stable per-provider account id (never the email). */
  providerAccountId: string
  email?: string | null
  name?: string | null
  avatarUrl?: string | null
}

/**
 * Resolve an OAuth login to a local user, creating the user and/or the account
 * link on first sight. Matching order:
 *   1. existing (provider, providerAccountId) link  → returning user
 *   2. existing user with the same email            → link a new provider
 *   3. brand-new user                               → create + link
 * Runs in a transaction so a half-linked account can never be persisted.
 */
export async function findOrCreateOAuthUser(identity: OAuthIdentity): Promise<User> {
  const { provider, providerAccountId } = identity
  const email = identity.email?.toLowerCase() || null

  return db.transaction(async (tx) => {
    const [existingLink] = await tx
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerAccountId, providerAccountId),
        ),
      )
      .limit(1)

    if (existingLink) {
      const [user] = await tx
        .update(users)
        .set({
          // Refresh the profile snapshot on every login, but never clobber a
          // known value with a null the provider happened to omit this time.
          name: identity.name ?? undefined,
          avatarUrl: identity.avatarUrl ?? undefined,
          email: email ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingLink.userId))
        .returning()
      return user!
    }

    let user: User | undefined
    if (email) {
      ;[user] = await tx.select().from(users).where(eq(users.email, email)).limit(1)
    }

    if (!user) {
      ;[user] = await tx
        .insert(users)
        .values({ email, name: identity.name ?? null, avatarUrl: identity.avatarUrl ?? null })
        .returning()
    }

    await tx
      .insert(oauthAccounts)
      .values({ provider, providerAccountId, userId: user!.id })
      .onConflictDoNothing()

    return user!
  })
}

/** Session `user` payload derived from a persisted user row. */
export function toSessionUser(
  user: User,
  provider: 'github' | 'google' | 'x' | 'linkedin' | 'webauthn',
) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    provider,
  }
}

// --- WebAuthn ---------------------------------------------------------------

/** Look up a user by email (the WebAuthn `userName`). */
export async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)
  return user
}

/** Load a user by primary key. */
export async function getUserById(id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return user
}

/** Create the user backing a brand-new passkey registration. */
export async function createWebauthnUser(email: string, displayName?: string): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ email: email.toLowerCase(), name: displayName ?? null })
    .returning()
  return user!
}

/** All registered passkeys for a user (used to build `allowCredentials`). */
export function getUserCredentials(userId: number) {
  return db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
}

/** Fetch a single passkey by its credential id. */
export async function getCredentialById(id: string) {
  const [credential] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.id, id))
    .limit(1)
  return credential
}

/** Persist a freshly registered passkey. */
export async function saveCredential(params: {
  id: string
  userId: number
  publicKey: string
  counter: number
  backedUp: boolean
  transports?: string[]
}) {
  await db.insert(webauthnCredentials).values({
    id: params.id,
    userId: params.userId,
    publicKey: params.publicKey,
    counter: params.counter,
    backedUp: params.backedUp,
    transports: JSON.stringify(params.transports ?? []),
  })
}

/** Bump the signature counter after a successful assertion (clone detection). */
export async function updateCredentialCounter(id: string, counter: number) {
  await db
    .update(webauthnCredentials)
    .set({ counter })
    .where(eq(webauthnCredentials.id, id))
}
