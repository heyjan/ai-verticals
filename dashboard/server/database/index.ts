/**
 * sql.js (WASM SQLite) singleton for the dashboard.
 *
 * Provides an async `getDb()` function that returns an initialised
 * sql.js Database instance.  The database is persisted to disk at
 * the path specified by `runtimeConfig.databasePath`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'

let dbInstance: Database | null = null
let initPromise: Promise<Database> | null = null

function getDbPath(): string {
  // Use the DATABASE_PATH env var, or fall back to the default
  const dbPath = process.env.DATABASE_PATH || '.data/jobs.db'
  // Resolve relative paths against the project root (process.cwd())
  return resolve(process.cwd(), dbPath)
}

async function initializeDb(): Promise<Database> {
  const dbPath = getDbPath()

  // Ensure the directory exists
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  // Initialise sql.js WASM engine
  // In production builds, locate the WASM file relative to node_modules
  const { createRequire } = await import('node:module')
  const { fileURLToPath } = await import('node:url')
  let wasmBinary: ArrayBuffer | undefined
  try {
    const require = createRequire(import.meta.url)
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
    const wasmBuffer = await readFile(wasmPath)
    wasmBinary = wasmBuffer.buffer.slice(
      wasmBuffer.byteOffset,
      wasmBuffer.byteOffset + wasmBuffer.byteLength,
    )
  } catch {
    // Fallback: let sql.js locate it automatically
  }
  const SQL = await initSqlJs({ wasmBinary })

  // Load existing database file if it exists
  let db: Database
  if (existsSync(dbPath)) {
    const fileBuffer = await readFile(dbPath)
    db = new SQL.Database(new Uint8Array(fileBuffer))
  }
  else {
    db = new SQL.Database()
  }

  // Create the schema (idempotent)
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL,
      city TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      salary TEXT DEFAULT '',
      job_level TEXT DEFAULT '',
      posted_ago TEXT DEFAULT '',
      contract_type TEXT DEFAULT '',
      sector TEXT DEFAULT '',
      url TEXT DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Other'
    );
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs (category);')
  db.run('CREATE INDEX IF NOT EXISTS idx_jobs_city ON jobs (city);')
  db.run('CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company);')

  dbInstance = db
  return db
}

/**
 * Get the singleton database instance.  Safe to call from any async
 * context — concurrent callers share the same initialisation promise.
 */
export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance
  if (!initPromise) {
    initPromise = initializeDb()
  }
  return initPromise
}

/**
 * Persist the in-memory database to disk.
 */
export async function saveDb(): Promise<void> {
  if (!dbInstance) return
  const data = dbInstance.export()
  const buffer = Buffer.from(data)
  const dbPath = getDbPath()
  await writeFile(dbPath, buffer)
}
