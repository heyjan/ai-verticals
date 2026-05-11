/**
 * GET /api/stats/top-companies
 *
 * Returns the top 20 companies by job count, each with an array
 * of distinct categories they hire for.
 */

import { getDb } from '../../database'

export default defineEventHandler(async () => {
  const db = await getDb()

  // Get top 20 companies by count
  const countResult = db.exec(
    'SELECT company, COUNT(*) as count FROM jobs GROUP BY company ORDER BY count DESC LIMIT 20',
  )

  if (countResult.length === 0) return []

  const companies = countResult[0].values.map(row => ({
    company: row[0] as string,
    count: row[1] as number,
  }))

  // For each company, get distinct categories
  const stmt = db.prepare(
    'SELECT DISTINCT category FROM jobs WHERE company = :company ORDER BY category',
  )

  const result = companies.map(({ company, count }) => {
    stmt.bind({ ':company': company })
    const categories: string[] = []
    while (stmt.step()) {
      categories.push(stmt.get()[0] as string)
    }
    stmt.reset()
    return { company, count, categories }
  })

  stmt.free()

  return result
})
