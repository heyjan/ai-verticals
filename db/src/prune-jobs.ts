import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { db, pg } from './client.ts'
import { jobs } from './schema.ts'

// Produced by scrapers.xing_prune / scrapers.linkedin_prune: the primary
// keys of listings whose detail page is gone or no longer accepting
// applications. We soft-delete them — set active=false rather than DELETE
// — so the description and enrichment we already scraped are retained.
// Source-agnostic: it only consumes dead_ids, so PRUNE_FILE points it at
// whichever pruner's output (xing-dead.json / linkedin-dead.json).
const PRUNE_FILE = process.env.PRUNE_FILE ?? '/app/data/processed/xing-dead.json'
const BATCH = 500

interface PruneInput {
  dead_ids?: number[]
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function main(): Promise<void> {
  if (!existsSync(PRUNE_FILE)) {
    throw new Error(`[prune] File not found: ${PRUNE_FILE}`)
  }
  console.log(`[prune] Reading ${PRUNE_FILE}`)
  const parsed = JSON.parse(await readFile(PRUNE_FILE, 'utf-8')) as PruneInput
  const ids = (parsed.dead_ids ?? []).filter((id) => Number.isInteger(id))

  if (ids.length === 0) {
    console.log('[prune] No dead listings found. Nothing to do.')
    return
  }

  console.log(`[prune] Marking ${ids.length} taken-down/closed listing(s) inactive`)
  // Only flip rows that are still active, so the count reflects newly
  // deactivated listings (not ones a prior run already handled).
  let deactivated = 0
  for (const batch of chunk(ids, BATCH)) {
    const result = await db
      .update(jobs)
      .set({ active: false, updatedAt: sql`now()` })
      .where(and(inArray(jobs.id, batch), eq(jobs.active, true)))
      .returning({ id: jobs.id })
    deactivated += result.length
  }
  console.log(`[prune] done. deactivated=${deactivated} (already-inactive rows skipped)`)
}

main()
  .catch((err) => {
    console.error('[prune] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
