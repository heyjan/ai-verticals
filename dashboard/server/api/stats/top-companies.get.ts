/**
 * GET /api/stats/top-companies?filter=all|us
 *
 * Returns the top 50 companies by job count, each with an array
 * of distinct categories they hire for.
 * When filter=us, only returns companies matching known US tech firms.
 */

import { getDb } from '../../database'

const US_COMPANY_PREFIXES = [
  'accenture',
  'adobe',
  'agilent',
  'amazon',
  'amd ',
  'anthropic',
  'apple',
  'applied materials',
  'aws ',
  'aws emea',
  'boeing',
  'boston scientific',
  'broadcom',
  'caterpillar',
  'cisco',
  'citi',
  'cloudflare',
  'cognizant',
  'coinbase',
  'corning',
  'crowdstrike',
  'cummins',
  'databricks',
  'datadog',
  'dell',
  'figma',
  'garmin',
  'ge aerospace',
  'ge healthcare',
  'general dynamics',
  'google',
  'hewlett packard',
  'honeywell',
  'ibm',
  'intel',
  'intuit',
  'intuitive',
  'iqvia',
  'john deere',
  'johnson & johnson',
  'jpmorgan',
  'keysight',
  'kraken',
  'merck',
  'meta platforms',
  'microsoft',
  'mongodb',
  'netflix',
  'nvidia',
  'nxp',
  'okta',
  'openai',
  'oracle',
  'palantir',
  'palo alto networks',
  'procter & gamble',
  'qualcomm',
  'salesforce',
  'servicenow',
  'snowflake',
  'spacex',
  'stripe',
  'stryker',
  'te connectivity',
  'tesla',
  'thermo fisher',
  'trimble',
  'twilio',
  'uber',
  'veeva systems',
  'vmware',
  'western digital',
  'workday',
  'zebra',
  'zscaler',
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
  const db = await getDb()

  const countResult = db.exec(
    'SELECT company, COUNT(*) as count FROM jobs GROUP BY company ORDER BY count DESC',
  )

  if (countResult.length === 0) return []

  let companies = countResult[0].values.map(row => ({
    company: row[0] as string,
    count: row[1] as number,
  }))

  if (filter === 'us') {
    companies = companies.filter(c => isUsCompany(c.company))
  }

  companies = companies.slice(0, 50)

  const stmt = db.prepare(
    'SELECT DISTINCT category FROM jobs WHERE company = :company ORDER BY category',
  )

  const descStmt = db.prepare(
    'SELECT description FROM company_descriptions WHERE company = :company',
  )

  const result = companies.map(({ company, count }) => {
    stmt.bind({ ':company': company })
    const categories: string[] = []
    while (stmt.step()) {
      categories.push(stmt.get()[0] as string)
    }
    stmt.reset()

    let description: string | null = null
    descStmt.bind({ ':company': company })
    if (descStmt.step()) {
      description = descStmt.get()[0] as string
    }
    descStmt.reset()

    return { company, count, categories, description }
  })

  stmt.free()
  descStmt.free()

  return result
})
