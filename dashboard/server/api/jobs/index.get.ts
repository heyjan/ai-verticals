/**
 * GET /api/jobs
 *
 * Paginated job listing with optional filters.
 *
 * Query parameters:
 *   - page     (default: 1)
 *   - limit    (default: 20, max: 100)
 *   - category (exact match)
 *   - city     (exact match)
 *   - search   (LIKE match against title and company)
 *
 * Returns { jobs, total, page, pages }
 */

import { getDb } from '../../database'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  const category = (query.category as string) || ''
  const city = (query.city as string) || ''
  const search = (query.search as string) || ''

  const db = await getDb()

  // Build dynamic WHERE clause
  const conditions: string[] = []
  const params: Record<string, string | number> = {}

  if (category) {
    conditions.push('category = :category')
    params[':category'] = category
  }
  if (city) {
    conditions.push('city = :city')
    params[':city'] = city
  }
  if (search) {
    conditions.push('(title LIKE :search OR company LIKE :search)')
    params[':search'] = `%${search}%`
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : ''

  // Count total matching rows
  const countStmt = db.prepare(`SELECT COUNT(*) FROM jobs ${whereClause}`)
  if (Object.keys(params).length > 0) countStmt.bind(params)
  countStmt.step()
  const total = countStmt.get()[0] as number
  countStmt.free()

  const pages = Math.ceil(total / limit)
  const offset = (page - 1) * limit

  // Fetch the page
  const dataParams = { ...params, ':limit': limit, ':offset': offset }
  const dataStmt = db.prepare(`
    SELECT id, source, source_id, title, company, location, city,
           salary, job_level, posted_ago, contract_type, sector, url, category
    FROM jobs
    ${whereClause}
    ORDER BY id ASC
    LIMIT :limit OFFSET :offset
  `)
  dataStmt.bind(dataParams)

  const jobs: Record<string, unknown>[] = []
  while (dataStmt.step()) {
    const row = dataStmt.getAsObject()
    jobs.push(row)
  }
  dataStmt.free()

  return {
    jobs,
    total,
    page,
    pages,
  }
})
