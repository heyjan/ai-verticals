/**
 * GET /api/jobs
 *
 * Paginated job listing with optional filters.
 */

import { jobs } from '@ai-job-classifier/db'
import { and, asc, count, eq, ilike, or, type SQL } from 'drizzle-orm'

import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  const category = (query.category as string) || ''
  const city = (query.city as string) || ''
  const search = (query.search as string) || ''

  const filters: SQL[] = []
  if (category) filters.push(eq(jobs.category, category))
  if (city) filters.push(eq(jobs.city, city))
  if (search) {
    const term = `%${search}%`
    const expr = or(ilike(jobs.title, term), ilike(jobs.company, term))
    if (expr) filters.push(expr)
  }
  const where = filters.length ? and(...filters) : undefined

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(jobs)
    .where(where)

  const pages = Math.ceil(total / limit)
  const offset = (page - 1) * limit

  const rows = await db
    .select({
      id: jobs.id,
      source: jobs.source,
      source_id: jobs.sourceId,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      city: jobs.city,
      salary: jobs.salary,
      job_level: jobs.jobLevel,
      posted_ago: jobs.postedAgo,
      contract_type: jobs.contractType,
      sector: jobs.sector,
      url: jobs.url,
      category: jobs.category,
    })
    .from(jobs)
    .where(where)
    .orderBy(asc(jobs.id))
    .limit(limit)
    .offset(offset)

  return { jobs: rows, total, page, pages }
})
