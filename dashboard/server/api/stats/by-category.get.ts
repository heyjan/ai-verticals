/**
 * GET /api/stats/by-category
 *
 * Returns an array of { category, count } sorted by count descending.
 */

import { getDb } from '../../database'

export default defineEventHandler(async () => {
  const db = await getDb()

  const result = db.exec(
    'SELECT category, COUNT(*) as count FROM jobs GROUP BY category ORDER BY count DESC',
  )

  if (result.length === 0) return []

  return result[0].values.map(row => ({
    category: row[0] as string,
    count: row[1] as number,
  }))
})
