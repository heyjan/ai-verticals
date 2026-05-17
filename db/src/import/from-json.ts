import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'

import { db, pg } from '../client.ts'
import { jobs } from '../schema.ts'

const JSON_PATH = process.env.IMPORT_FILE ?? '/app/data/processed/merged-latest.json'
const BATCH = 500

interface RawJob {
  source?: string
  source_id?: string
  title?: string
  company?: string
  location?: string
  city?: string
  description?: string
  salary?: string
  job_level?: string
  posted_ago?: string
  contract_type?: string
  sector?: string
  url?: string
  category?: string
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function main(): Promise<void> {
  if (!existsSync(JSON_PATH)) {
    throw new Error(`[import] File not found: ${JSON_PATH}`)
  }
  console.log(`[import] Reading ${JSON_PATH}`)
  const raw: RawJob[] = JSON.parse(await readFile(JSON_PATH, 'utf-8'))

  const rows = raw
    .filter((r) => r.source && r.source_id && r.title && r.company)
    .map((r) => ({
      source: r.source!,
      sourceId: r.source_id!,
      title: r.title!,
      company: r.company!,
      location: r.location ?? '',
      city: r.city ?? '',
      description: r.description ?? '',
      salary: r.salary ?? '',
      jobLevel: r.job_level ?? '',
      postedAgo: r.posted_ago ?? '',
      contractType: r.contract_type ?? '',
      sector: r.sector ?? '',
      url: r.url ?? '',
      category: r.category ?? 'Other',
    }))

  console.log(`[import] Upserting ${rows.length} jobs`)

  let inserted = 0
  let updated = 0

  for (const batch of chunk(rows, BATCH)) {
    const result = await db
      .insert(jobs)
      .values(batch)
      .onConflictDoUpdate({
        target: [jobs.source, jobs.sourceId],
        set: {
          title: sql`excluded.title`,
          company: sql`excluded.company`,
          location: sql`excluded.location`,
          city: sql`excluded.city`,
          description: sql`excluded.description`,
          salary: sql`excluded.salary`,
          jobLevel: sql`excluded.job_level`,
          postedAgo: sql`excluded.posted_ago`,
          contractType: sql`excluded.contract_type`,
          sector: sql`excluded.sector`,
          url: sql`excluded.url`,
          category: sql`excluded.category`,
          lastSeenAt: sql`now()`,
        },
      })
      .returning({
        id: jobs.id,
        createdAt: jobs.createdAt,
        lastSeenAt: jobs.lastSeenAt,
      })

    // A row is "new" if its createdAt equals lastSeenAt (within this run).
    for (const r of result) {
      if (r.createdAt.getTime() === r.lastSeenAt.getTime()) inserted++
      else updated++
    }
  }

  console.log(`[import] done. inserted=${inserted} updated=${updated}`)
}

main()
  .catch((err) => {
    console.error('[import] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
