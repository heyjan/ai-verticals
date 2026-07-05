/**
 * GET /api/stats/overview
 *
 * Returns high-level dashboard statistics + daily-scrape activity.
 *
 * - newToday      : rows where first_seen_at::date = current_date (UTC).
 * - updatedToday  : rows seen-again today but not freshly inserted
 *                   (last_seen_at::date = today, first_seen_at::date != today).
 * - lastScrapeAt  : max(last_seen_at) — wall-clock of the latest import.
 */

import { jobs } from '@ai-job-classifier/db'
import { count, countDistinct, eq, max, sql } from 'drizzle-orm'

import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const [overview] = await db
    .select({
      total: count(),
      totalCompanies: countDistinct(jobs.company),
      totalCities: countDistinct(jobs.city),
      totalCategories: countDistinct(jobs.category),
      withSalary: sql<number>`count(*) FILTER (WHERE ${jobs.salary} <> '')`.mapWith(Number),
      withDescription: sql<number>`count(*) FILTER (WHERE ${jobs.description} <> '')`.mapWith(Number),
      newToday: sql<number>`count(*) FILTER (WHERE ${jobs.firstSeenAt}::date = current_date)`.mapWith(Number),
      updatedToday: sql<number>`count(*) FILTER (WHERE ${jobs.lastSeenAt}::date = current_date AND ${jobs.firstSeenAt}::date <> current_date)`.mapWith(Number),
      lastScrapeAtRaw: max(jobs.lastSeenAt),
      lastUpdatedRaw: max(jobs.updatedAt),
    })
    .from(jobs)
    .where(eq(jobs.active, true))

  const sourceRows = await db
    .select({ source: jobs.source, cnt: count() })
    .from(jobs)
    .where(eq(jobs.active, true))
    .groupBy(jobs.source)
    .orderBy(sql`count(*) DESC`)

  const sources: Record<string, number> = {}
  for (const row of sourceRows) {
    const normalised = row.source.includes('+') ? row.source.split('+')[0] : row.source
    sources[normalised] = (sources[normalised] || 0) + row.cnt
  }

  return {
    total: overview.total,
    totalCompanies: overview.totalCompanies,
    totalCities: overview.totalCities,
    totalCategories: overview.totalCategories,
    withSalary: overview.withSalary,
    withDescription: overview.withDescription,
    newToday: overview.newToday,
    updatedToday: overview.updatedToday,
    sources,
    lastScrapeAt: overview.lastScrapeAtRaw?.toISOString() ?? null,
    lastUpdated: overview.lastUpdatedRaw?.toISOString() ?? null,
  }
})
