/**
 * GET /api/stats/by-level
 */

import { jobs } from '@ai-job-classifier/db'
import { count, sql } from 'drizzle-orm'

import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await db
    .select({ level: jobs.jobLevel, count: count() })
    .from(jobs)
    .groupBy(jobs.jobLevel)
    .orderBy(sql`count(*) DESC`)

  return rows
})
