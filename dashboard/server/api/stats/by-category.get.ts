/**
 * GET /api/stats/by-category
 */

import { jobs } from '@ai-job-classifier/db'
import { count, sql } from 'drizzle-orm'

import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await db
    .select({ category: jobs.category, count: count() })
    .from(jobs)
    .groupBy(jobs.category)
    .orderBy(sql`count(*) DESC`)

  return rows
})
