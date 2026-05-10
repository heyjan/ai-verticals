/**
 * GET /api/stats/overview
 *
 * Returns high-level dashboard statistics:
 *   - total jobs, companies, cities
 *   - jobs with salary info, jobs with a description
 *   - breakdown by source
 */

import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getDb } from '../../database'

export default defineEventHandler(async () => {
  const db = await getDb()

  const total = (db.exec('SELECT COUNT(*) FROM jobs')[0]?.values[0]?.[0] as number) ?? 0
  const totalCompanies = (db.exec('SELECT COUNT(DISTINCT company) FROM jobs')[0]?.values[0]?.[0] as number) ?? 0
  const totalCities = (db.exec('SELECT COUNT(DISTINCT city) FROM jobs')[0]?.values[0]?.[0] as number) ?? 0

  const totalCategories = (db.exec('SELECT COUNT(DISTINCT category) FROM jobs')[0]?.values[0]?.[0] as number) ?? 0

  const withSalary = (db.exec(
    "SELECT COUNT(*) FROM jobs WHERE salary IS NOT NULL AND salary != ''",
  )[0]?.values[0]?.[0] as number) ?? 0

  const withDescription = (db.exec(
    "SELECT COUNT(*) FROM jobs WHERE description IS NOT NULL AND description != ''",
  )[0]?.values[0]?.[0] as number) ?? 0

  // Source breakdown
  const sourceRows = db.exec(
    'SELECT source, COUNT(*) as cnt FROM jobs GROUP BY source ORDER BY cnt DESC',
  )

  const sources: Record<string, number> = {}
  if (sourceRows.length > 0) {
    for (const row of sourceRows[0].values) {
      // Normalise compound sources like "linkedin+linkedin+..."
      const rawSource = String(row[0])
      const normalisedSource = rawSource.includes('+')
        ? rawSource.split('+')[0]
        : rawSource
      sources[normalisedSource] = (sources[normalisedSource] || 0) + (row[1] as number)
    }
  }

  let lastUpdated: string | null = null
  try {
    const dbPath = resolve(process.cwd(), process.env.DATABASE_PATH || '.data/jobs.db')
    const st = await stat(dbPath)
    lastUpdated = st.mtime.toISOString()
  } catch {}

  return {
    total,
    totalCompanies,
    totalCities,
    totalCategories,
    withSalary,
    withDescription,
    sources,
    lastUpdated,
  }
})
