/**
 * GET /api/stats/city-detail?city=...
 *
 * Returns salary statistics for a given city.
 */

import { jobs } from '@ai-job-classifier/db'
import { and, eq, ilike, like, sql } from 'drizzle-orm'

import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const city = (query.city as string || '').trim()
  if (!city) return { error: 'city parameter required' }

  const rows = await db
    .select({
      salary: jobs.salary,
      title: jobs.title,
      company: jobs.company,
      url: jobs.url,
      category: jobs.category,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.active, true),
        sql`lower(${jobs.city}) = lower(${city})`,
        sql`${jobs.salary} <> ''`,
        like(jobs.salary, '%EUR%'),
      ),
    )

  if (!rows.length) return { city, salaries: [], count: 0 }

  const internPattern = /\b(trainee|internship|intern|praktik)/i
  const parsed: {
    low: number
    high: number
    title: string
    company: string
    url: string
    category: string
  }[] = []

  for (const row of rows) {
    try {
      if (internPattern.test(row.title || '')) continue
      const raw = row.salary
      const isHourly = raw.includes('(hourly)')
      const isMonthly = raw.includes('(monthly)')
      const nums = raw.split(' ')[0]
      let [low, high] = nums.split('-').map(Number)
      if (isHourly) continue
      if (isMonthly) { low *= 12; high *= 12 }
      if (low >= 30000 && high >= 30000) {
        parsed.push({
          low: Math.round(low),
          high: Math.round(high),
          title: row.title || '',
          company: row.company || '',
          url: row.url || '',
          category: row.category || '',
        })
      }
    } catch {}
  }

  if (!parsed.length) return { city, salaries: [], count: 0 }

  parsed.sort((a, b) => a.low - b.low)

  const lows = parsed.map(s => s.low)
  const highs = parsed.map(s => s.high)
  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  return {
    city,
    count: parsed.length,
    min: Math.min(...lows),
    max: Math.max(...highs),
    avgLow: Math.round(lows.reduce((s, v) => s + v, 0) / lows.length),
    avgHigh: Math.round(highs.reduce((s, v) => s + v, 0) / highs.length),
    medianLow: median(lows),
    medianHigh: median(highs),
    ranges: parsed,
  }
})
