/**
 * GET /api/stats/top-companies?filter=all|us
 */

import { companyDescriptions, jobs } from '@ai-job-classifier/db'
import { and, count, eq, sql } from 'drizzle-orm'

import { db } from '../../utils/db'

const US_COMPANY_PREFIXES = [
  'accenture', 'adobe', 'agilent', 'amazon', 'amd ', 'anthropic', 'apple',
  'applied materials', 'aws ', 'aws emea', 'boeing', 'boston scientific',
  'broadcom', 'caterpillar', 'cisco', 'citi', 'cloudflare', 'cognizant',
  'coinbase', 'corning', 'crowdstrike', 'cummins', 'databricks', 'datadog',
  'dell', 'figma', 'garmin', 'ge aerospace', 'ge healthcare',
  'general dynamics', 'google', 'hewlett packard', 'honeywell', 'ibm',
  'intel', 'intuit', 'intuitive', 'iqvia', 'john deere',
  'johnson & johnson', 'jpmorgan', 'keysight', 'kraken', 'merck',
  'meta platforms', 'microsoft', 'mongodb', 'netflix', 'nvidia', 'nxp',
  'okta', 'openai', 'oracle', 'palantir', 'palo alto networks',
  'procter & gamble', 'qualcomm', 'salesforce', 'servicenow', 'snowflake',
  'spacex', 'stripe', 'stryker', 'te connectivity', 'tesla',
  'thermo fisher', 'trimble', 'twilio', 'uber', 'veeva systems', 'vmware',
  'western digital', 'workday', 'zebra', 'zscaler',
]

const US_EXCLUDE = ['amazonen-werke', 'citizengo', 'snapaddy', 'merck kgaa', 'merck group', 'merck healthcare']

function isUsCompany(name: string): boolean {
  const lower = name.toLowerCase()
  if (US_EXCLUDE.some(p => lower.includes(p))) return false
  return US_COMPANY_PREFIXES.some(p => lower.startsWith(p))
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const filter = (query.filter as string) || 'all'

  const counts = await db
    .select({ company: jobs.company, count: count() })
    .from(jobs)
    .where(eq(jobs.active, true))
    .groupBy(jobs.company)
    .orderBy(sql`count(*) DESC`)

  let companies = filter === 'us' ? counts.filter(c => isUsCompany(c.company)) : counts
  companies = companies.slice(0, 50)
  if (!companies.length) return []

  const names = companies.map(c => c.company)

  // Bind the company-name list as a single Postgres text[] parameter via
  // sql.join. Interpolating a JS array directly into the `sql` template
  // expands it to a record `($1,$2,…)`, which Postgres rejects when cast
  // to text[] with "cannot cast type record to text[]".
  const namesArr = sql`ARRAY[${sql.join(names.map(n => sql`${n}`), sql`, `)}]::text[]`

  const categoryRows = await db
    .selectDistinct({ company: jobs.company, category: jobs.category })
    .from(jobs)
    .where(and(eq(jobs.active, true), sql`${jobs.company} = ANY(${namesArr})`))
    .orderBy(jobs.category)

  const categoriesByCompany = new Map<string, string[]>()
  for (const r of categoryRows) {
    const arr = categoriesByCompany.get(r.company) ?? []
    arr.push(r.category)
    categoriesByCompany.set(r.company, arr)
  }

  const descRows = await db
    .select({ company: companyDescriptions.company, description: companyDescriptions.description })
    .from(companyDescriptions)
    .where(sql`${companyDescriptions.company} = ANY(${namesArr})`)

  const descByCompany = new Map(descRows.map(r => [r.company, r.description]))

  return companies.map(({ company, count }) => ({
    company,
    count,
    categories: categoriesByCompany.get(company) ?? [],
    description: descByCompany.get(company) ?? null,
  }))
})
