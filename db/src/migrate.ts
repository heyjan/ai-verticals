import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set')

const migrationClient = postgres(DATABASE_URL, { max: 1 })

await migrate(drizzle(migrationClient), { migrationsFolder: './migrations' })
await migrationClient.end()

console.log('[migrate] up to date')
