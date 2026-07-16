import { count } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import { db, pg } from '../client.ts'
import { jobs } from '../schema.ts'
import { configureChatReadonlyRole } from '../configure-chat-role.ts'
import { assertSeedCounts, seedFromSqlite } from './from-sqlite.ts'

async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const migrationClient = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: './migrations' })
    await configureChatReadonlyRole(migrationClient)
    console.log('[seed] migrations applied')
  } finally {
    await migrationClient.end()
  }
}

async function main(): Promise<void> {
  await runMigrations()

  const [{ value: existing }] = await db.select({ value: count() }).from(jobs)
  if (existing > 0) {
    console.log(`[seed] jobs table already has ${existing} rows — skipping bootstrap`)
    return
  }

  await seedFromSqlite()
  await assertSeedCounts()
  console.log('[seed] bootstrap complete')
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
