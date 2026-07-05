/**
 * GET /api/stats/by-category
 */

import { jobs } from '@ai-job-classifier/db'
import { count, eq, sql } from 'drizzle-orm'

import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await db
    .select({ category: jobs.category, count: count() })
    .from(jobs)
    .where(eq(jobs.active, true))
    .groupBy(jobs.category)
    .orderBy(sql`count(*) DESC`)

  return rows
})
