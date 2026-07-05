import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { eq, sql } from 'drizzle-orm'

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
  date_posted?: string
  contract_type?: string
  sector?: string
  url?: string
  category?: string
}

// A directive (from scrapers.resolve_db) to fold a new posting into an
// existing DB row identified by primary key — instead of inserting a
// duplicate. Carries the already-merged enrichment fields.
interface MergeDirective {
  id: number
  source: string
  description?: string
  salary?: string
  job_level?: string
  posted_ago?: string
  date_posted?: string
  contract_type?: string
  sector?: string
  location?: string
}

// The importer reads either the legacy flat array of jobs, or the resolved
// shape { new, merges } produced by the cross-DB dedup step.
interface Resolved {
  new: RawJob[]
  merges: MergeDirective[]
}

function asResolved(parsed: unknown): Resolved {
  if (Array.isArray(parsed)) return { new: parsed as RawJob[], merges: [] }
  const r = parsed as Partial<Resolved>
  return { new: r.new ?? [], merges: r.merges ?? [] }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Extract a YYYY-MM-DD date from the source's date_posted string
// (LinkedIn: "2026-06-01", Xing JSON-LD: "2026-05-28T00:00:00Z"). Returns
// null for empty/relative/garbage values so the date column stays clean.
function toPostedDate(raw: string | undefined): string | null {
  const m = (raw ?? '').match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

async function main(): Promise<void> {
  if (!existsSync(JSON_PATH)) {
    throw new Error(`[import] File not found: ${JSON_PATH}`)
  }
  console.log(`[import] Reading ${JSON_PATH}`)
  const { new: rawNew, merges } = asResolved(JSON.parse(await readFile(JSON_PATH, 'utf-8')))

  const rows = rawNew
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
      postedDate: toPostedDate(r.date_posted),
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
          // Keep a known posting date if a later re-import (e.g. a
          // Glassdoor dup with no absolute date) carries null.
          postedDate: sql`COALESCE(excluded.posted_date, jobs.posted_date)`,
          contractType: sql`excluded.contract_type`,
          sector: sql`excluded.sector`,
          url: sql`excluded.url`,
          // Preserve any non-default category already in the DB. The
          // merged JSON has no category field (defaults to 'Other'), so
          // letting `excluded.category` win would clobber labels that
          // came from the original seed or from a prior classify run.
          category: sql`CASE WHEN excluded.category = 'Other' THEN jobs.category ELSE excluded.category END`,
          // Re-appearing in a scrape means the listing is live again, so
          // reactivate anything a prior prune had soft-deleted.
          active: true,
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

  // Fold cross-DB duplicates into their matched existing rows: union the
  // source and fill the more-complete fields (already computed by
  // resolve_db), refresh last_seen_at. These would otherwise have been
  // inserted as duplicate rows by the exact-key upsert above.
  let folded = 0
  for (const m of merges) {
    await db
      .update(jobs)
      .set({
        source: m.source,
        description: sql`CASE WHEN ${m.description ?? ''} = '' THEN ${jobs.description} ELSE ${m.description ?? ''} END`,
        salary: sql`CASE WHEN ${m.salary ?? ''} = '' THEN ${jobs.salary} ELSE ${m.salary ?? ''} END`,
        jobLevel: sql`CASE WHEN ${m.job_level ?? ''} = '' THEN ${jobs.jobLevel} ELSE ${m.job_level ?? ''} END`,
        postedAgo: sql`CASE WHEN ${m.posted_ago ?? ''} = '' THEN ${jobs.postedAgo} ELSE ${m.posted_ago ?? ''} END`,
        postedDate: sql`COALESCE(${toPostedDate(m.date_posted)}, ${jobs.postedDate})`,
        contractType: sql`CASE WHEN ${m.contract_type ?? ''} = '' THEN ${jobs.contractType} ELSE ${m.contract_type ?? ''} END`,
        sector: sql`CASE WHEN ${m.sector ?? ''} = '' THEN ${jobs.sector} ELSE ${m.sector ?? ''} END`,
        location: sql`CASE WHEN ${m.location ?? ''} = '' THEN ${jobs.location} ELSE ${m.location ?? ''} END`,
        active: true,
        lastSeenAt: sql`now()`,
      })
      .where(eq(jobs.id, m.id))
    folded++
  }

  console.log(`[import] done. inserted=${inserted} updated=${updated} folded=${folded}`)
}

main()
  .catch((err) => {
    console.error('[import] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
