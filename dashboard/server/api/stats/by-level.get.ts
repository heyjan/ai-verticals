/**
 * GET /api/stats/by-level
 *
 * Returns an array of { level, count } for distinct job levels,
 * sorted by count descending.
 */

import { getDb } from '../../database'

export default defineEventHandler(async () => {
  const db = await getDb()

  const result = db.exec(
    'SELECT job_level, COUNT(*) as count FROM jobs GROUP BY job_level ORDER BY count DESC',
  )

  if (result.length === 0) return []

  return result[0].values.map(row => ({
    level: row[0] as string,
    count: row[1] as number,
  }))
})
