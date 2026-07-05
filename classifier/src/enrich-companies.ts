/**
 * Fetch short German-language descriptions for the top companies in
 * the dataset and write them into the `company_descriptions` table.
 *
 * Top = top 50 by job count + top 50 by job count restricted to known
 * US-headquartered firms (the dashboard's "US filter" needs the latter).
 */

import { config } from 'dotenv'
import { companyDescriptions, db, jobs, pg } from '@ai-job-classifier/db'
import { count, desc, sql } from 'drizzle-orm'
import OpenAI from 'openai'

config({ path: '.env' })

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('[enrich] Missing DEEPSEEK_API_KEY in .env')
  process.exit(1)
}

const client = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey,
})

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
  if (US_EXCLUDE.some((p) => lower.includes(p))) return false
  return US_COMPANY_PREFIXES.some((p) => lower.startsWith(p))
}

async function getDescription(companyName: string): Promise<string> {
  const res = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content:
          'Du bist ein präziser Business-Analyst. Zu einem Firmennamen lieferst du eine Beschreibung in 2-3 Sätzen: Was macht das Unternehmen, in welcher Branche ist es tätig, und welche Relevanz hat es für KI/Tech? Falls du dir unsicher bist, sag das kurz. Antworte ausschließlich auf Deutsch.',
      },
      { role: 'user', content: `Beschreibe das Unternehmen: ${companyName}` },
    ],
    max_tokens: 200,
    temperature: 0.3,
  })

  return res.choices[0]?.message?.content?.trim() ?? ''
}

async function main(): Promise<void> {
  const allCompanies = await db
    .select({ company: jobs.company, count: count() })
    .from(jobs)
    .groupBy(jobs.company)
    .orderBy(desc(count()))

  if (!allCompanies.length) {
    console.log('[enrich] No companies found in the database.')
    return
  }

  const top50All = allCompanies.slice(0, 50).map((c) => c.company)
  const top50Us = allCompanies
    .filter((c) => isUsCompany(c.company))
    .slice(0, 50)
    .map((c) => c.company)

  const targets = Array.from(new Set([...top50All, ...top50Us]))

  // Keep existing descriptions; only fetch firms that newly entered the top
  // set and don't have one yet. Pass FORCE=1 to re-fetch everything.
  const force = process.env.FORCE === '1'
  const existing = force
    ? []
    : await db.select({ company: companyDescriptions.company }).from(companyDescriptions)
  const known = new Set(existing.map((r) => r.company))

  const toEnrich = targets.filter((c) => !known.has(c))
  console.log(
    `[enrich] ${top50All.length} top overall + ${top50Us.length} top US = ${targets.length} unique targets; ${known.size} already stored, ${toEnrich.length} new to fetch`,
  )

  if (!toEnrich.length) {
    console.log('[enrich] Nothing new to enrich.')
    return
  }

  let success = 0
  for (const company of toEnrich) {
    try {
      console.log(`[enrich] ${success + 1}/${toEnrich.length} — ${company}`)
      const description = await getDescription(company)
      if (description) {
        await db
          .insert(companyDescriptions)
          .values({ company, description })
          .onConflictDoUpdate({
            target: companyDescriptions.company,
            set: { description: sql`excluded.description` },
          })
        success++
      } else {
        console.warn(`[enrich] Empty response for "${company}", skipping`)
      }
    } catch (err) {
      console.error(`[enrich] Failed for "${company}":`, err)
    }
  }

  console.log(`[enrich] Done. Stored descriptions for ${success}/${toEnrich.length} companies.`)
}

main()
  .catch((err) => {
    console.error('[enrich] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
