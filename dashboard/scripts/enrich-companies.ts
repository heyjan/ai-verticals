import { config } from 'dotenv'
import { getDb, saveDb } from '../server/database/index.js'
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
      {
        role: 'user',
        content: `Beschreibe das Unternehmen: ${companyName}`,
      },
    ],
    max_tokens: 200,
    temperature: 0.3,
  })

  return res.choices[0]?.message?.content?.trim() ?? ''
}

async function main() {
  const db = await getDb()

  const rows = db.exec(
    'SELECT company, COUNT(*) as cnt FROM jobs GROUP BY company ORDER BY cnt DESC',
  )

  if (!rows.length || !rows[0].values.length) {
    console.log('[enrich] No companies found in the database.')
    return
  }

  const allCompanies = rows[0].values.map((r) => ({
    company: r[0] as string,
    count: r[1] as number,
  }))

  const top50All = allCompanies.slice(0, 50).map((c) => c.company)
  const top50Us = allCompanies
    .filter((c) => isUsCompany(c.company))
    .slice(0, 50)
    .map((c) => c.company)

  const toEnrich = [...new Set([...top50All, ...top50Us])]

  console.log(
    `[enrich] ${top50All.length} top overall + ${top50Us.length} top US = ${toEnrich.length} unique companies`,
  )

  db.run('DELETE FROM company_descriptions')
  console.log('[enrich] Cleared existing descriptions')

  const stmt = db.prepare(
    'INSERT INTO company_descriptions (company, description) VALUES (:company, :description)',
  )

  let success = 0
  for (const company of toEnrich) {
    try {
      console.log(`[enrich] ${success + 1}/${toEnrich.length} — ${company}`)
      const description = await getDescription(company)
      if (description) {
        stmt.run({ ':company': company, ':description': description })
        success++
      } else {
        console.warn(`[enrich] Empty response for "${company}", skipping`)
      }
    } catch (err) {
      console.error(`[enrich] Failed for "${company}":`, err)
    }
  }

  stmt.free()
  await saveDb()

  console.log(`[enrich] Done. Stored descriptions for ${success}/${toEnrich.length} companies.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
