/**
 * GET /api/stats/growth
 *
 * Time-series telemetry for the "growth" viewport tab. Two independent
 * signals, because they answer different questions:
 *
 *  - posting  : jobs grouped by `posted_date` (the real-world date the role
 *               went live). A continuous daily series (gaps filled with 0 via
 *               generate_series) so weekday/weekend rhythm is visible. Only
 *               ~40% of rows carry a posted_date (LinkedIn ~91%, Xing 0%), so
 *               this is the *posting-activity* trend, not the whole dataset.
 *  - intake   : rows grouped by `first_seen_at::date` (when WE first ingested
 *               them). Lumpy — one spike per scrape/backfill — but it's the
 *               honest "our dataset is growing" curve. The client turns this
 *               into a cumulative line.
 *
 * `summary` carries the headline KPIs.
 */

import { sql } from 'drizzle-orm'

import { db } from '../../utils/db'

interface PostingRow { date: string; count: number; dow: number }
interface IntakeRow { date: string; count: number }
interface SummaryRow {
  total: number
  new_last3: number
  posted_last7: number
  posted_prev7: number
  with_posted: number
  sources: number
  total_companies: number
  new_companies3: number
  total_cities: number
  new_cities3: number
}

export default defineEventHandler(async () => {
  // Daily posting activity, gap-filled, capped to the most recent ~90 days
  // (or the start of our posted_date history, whichever is later).
  const posting = (await db.execute(sql`
    SELECT
      to_char(g, 'YYYY-MM-DD')        AS date,
      coalesce(p.cnt, 0)::int         AS count,
      extract(dow from g)::int        AS dow
    FROM generate_series(
      greatest(
        coalesce((SELECT min(posted_date) FROM jobs WHERE active), current_date - 89),
        current_date - 89
      ),
      current_date,
      interval '1 day'
    ) AS g
    LEFT JOIN (
      SELECT posted_date AS d, count(*)::int AS cnt
      FROM jobs
      WHERE active AND posted_date IS NOT NULL
      GROUP BY 1
    ) p ON p.d = g::date
    ORDER BY g
  `)) as unknown as PostingRow[]

  // Ingestion cadence — one row per day we imported anything.
  const intake = (await db.execute(sql`
    SELECT to_char(first_seen_at::date, 'YYYY-MM-DD') AS date, count(*)::int AS count
    FROM jobs
    WHERE active
    GROUP BY first_seen_at::date
    ORDER BY first_seen_at::date
  `)) as unknown as IntakeRow[]

  const [summary] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM jobs WHERE active)::int                             AS total,
      (SELECT count(*) FROM jobs WHERE active AND posted_date >  current_date - 3)::int  AS new_last3,
      (SELECT count(*) FROM jobs WHERE active AND posted_date >= current_date - 6)::int  AS posted_last7,
      (SELECT count(*) FROM jobs
         WHERE active
           AND posted_date >= current_date - 13
           AND posted_date <= current_date - 7)::int                           AS posted_prev7,
      (SELECT count(posted_date) FROM jobs WHERE active)::int                  AS with_posted,
      (SELECT count(DISTINCT split_part(source, '+', 1)) FROM jobs WHERE active)::int AS sources,
      -- Companies & cities: total distinct + how many were first discovered
      -- in the last 3 days (HAVING min(first_seen_at) inside the window).
      -- These are net-new entities entering the dataset, not job counts.
      (SELECT count(DISTINCT company) FROM jobs WHERE active AND company <> '')::int AS total_companies,
      (SELECT count(*) FROM (
         SELECT company FROM jobs WHERE active AND company <> ''
         GROUP BY company HAVING min(first_seen_at)::date > current_date - 3
       ) c)::int                                                               AS new_companies3,
      (SELECT count(DISTINCT city) FROM jobs WHERE active AND city <> '')::int AS total_cities,
      (SELECT count(*) FROM (
         SELECT city FROM jobs WHERE active AND city <> ''
         GROUP BY city HAVING min(first_seen_at)::date > current_date - 3
       ) c)::int                                                               AS new_cities3
  `)) as unknown as SummaryRow[]

  return { summary, posting, intake }
})
