/**
 * GET /api/jobs/recent
 *
 * The "fresh postings" feed for the growth tab — jobs whose posted_date falls
 * within the last 3 days, newest first. Drives the one-job-at-a-time scroll
 * card (mirrors the per-city job card on the map). posted_date is the right
 * signal here: it tracks the genuine daily intake (the cron scrapes LinkedIn,
 * which carries posted_date) and self-trims as the 7-day base set ages out.
 */

import { sql } from 'drizzle-orm'

import { db } from '../../utils/db'

interface RecentRow {
  id: number
  title: string
  company: string
  city: string
  category: string
  salary: string
  url: string
  source: string
  posted_date: string
  age_days: number
}

export default defineEventHandler(async () => {
  const rows = (await db.execute(sql`
    SELECT
      id,
      title,
      company,
      city,
      category,
      salary,
      url,
      split_part(source, '+', 1)        AS source,
      to_char(posted_date, 'YYYY-MM-DD') AS posted_date,
      (current_date - posted_date)::int  AS age_days
    FROM jobs
    WHERE active
      AND posted_date IS NOT NULL
      AND posted_date > current_date - 3
    ORDER BY posted_date DESC, id DESC
    LIMIT 400
  `)) as unknown as RecentRow[]

  return { jobs: rows, count: rows.length }
})
