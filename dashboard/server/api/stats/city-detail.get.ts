import { getDb } from '../../database'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const city = (query.city as string || '').trim()
  if (!city) return { error: 'city parameter required' }

  const db = await getDb()

  const rows = db.exec(
    `SELECT salary, title FROM jobs WHERE LOWER(city) = LOWER(?) AND salary IS NOT NULL AND salary != '' AND salary LIKE '%EUR%'`,
    [city],
  )

  if (!rows.length || !rows[0].values.length) return { city, salaries: [], count: 0 }

  const internPattern = /\b(trainee|internship|intern|praktik)/i

  const parsed: { low: number; high: number }[] = []
  for (const row of rows[0].values) {
    const raw = row[0] as string
    const title = (row[1] as string) || ''
    try {
      if (internPattern.test(title)) continue
      const isHourly = raw.includes('(hourly)')
      const isMonthly = raw.includes('(monthly)')
      const nums = raw.split(' ')[0]
      let [low, high] = nums.split('-').map(Number)
      if (isHourly) continue
      if (isMonthly) { low *= 12; high *= 12 }
      if (low >= 30000 && high >= 30000) parsed.push({ low: Math.round(low), high: Math.round(high) })
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
