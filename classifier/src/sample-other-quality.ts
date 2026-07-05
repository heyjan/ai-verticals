/**
 * One-off audit: pull 100 random jobs currently labeled 'Other', ask
 * DeepSeek to judge {is_ai_relevant, category} for each, and report
 * the split. Helps decide whether the 'Other' bucket is dominated by
 * (a) AI-relevant jobs missing categorization, or (b) genuine noise
 * leaking through clean.py.
 */

import { config } from 'dotenv'
import { db, jobs, pg } from '@ai-job-classifier/db'
import { eq, sql } from 'drizzle-orm'
import OpenAI from 'openai'

config({ path: '.env' })

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('Missing DEEPSEEK_API_KEY')
  process.exit(1)
}

const client = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey,
})

const CATEGORIES = [
  'Training/Annotation',
  'Robotics/Hardware',
  'Research',
  'Data Science/ML',
  'Data Engineering',
  'Product/Design',
  'Consulting',
  'Sales/Marketing',
  'HR/People',
  'Finance/Legal',
  'Operations/Logistics',
  'Management',
  'Engineering/Development',
  'Other',
] as const

const BATCH_SIZE = 20
const DESC_CHAR_LIMIT = 600
const SAMPLE_SIZE = 100

interface JobRow {
  id: number
  title: string
  description: string
  company: string
}

interface Judgement {
  job_id: number
  is_ai_relevant: boolean
  category: string
  reason: string
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function judgeBatch(batch: JobRow[]): Promise<Judgement[]> {
  const jobsText = batch
    .map((j) => {
      const desc = (j.description || '').slice(0, DESC_CHAR_LIMIT).replace(/\s+/g, ' ').trim()
      return `[job_id=${j.id}] ${j.title} @ ${j.company}\n${desc}`
    })
    .join('\n\n')

  const systemPrompt =
    'You are a labor-market analyst classifying job listings scraped from LinkedIn/Glassdoor ' +
    'in Germany using AI-related search queries (artificial intelligence, machine learning, LLM, etc.).\n\n' +
    'For each listing, decide:\n' +
    '  1. is_ai_relevant: true if the job substantively involves AI/ML work (building, ' +
    'operating, researching, or selling AI/ML systems). False for: generic engineering at ' +
    'an AI company, marketing roles unrelated to AI products, "uses AI tools" mentions, ' +
    'or boilerplate "we leverage AI" in description.\n' +
    `  2. category: ONE of ${CATEGORIES.map((c) => `"${c}"`).join(', ')}. ` +
    'Pick the best fit based on the role itself, not the company. Use "Other" only when no ' +
    'category fits at all.\n' +
    '  3. reason: 6-12 word justification.\n\n' +
    'Return strict JSON: { "labels": [ { "job_id": number, "is_ai_relevant": boolean, "category": string, "reason": string } ] }'

  const res = await client.chat.completions.create({
    model: 'deepseek-chat',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Jobs:\n${jobsText}` },
    ],
    temperature: 0.1,
    max_tokens: 3000,
  })

  const content = res.choices[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(content) as { labels: Judgement[] }
  return parsed.labels ?? []
}

async function main(): Promise<void> {
  const rows = (await db.execute(
    sql`SELECT id, title, description, company FROM jobs WHERE category = 'Other' ORDER BY random() LIMIT ${SAMPLE_SIZE}`,
  )) as unknown as JobRow[]

  console.log(`[sample] Pulled ${rows.length} random 'Other' jobs`)
  if (!rows.length) {
    console.log('No Other jobs found.')
    return
  }

  const all: Judgement[] = []
  const batches = chunk(rows, BATCH_SIZE)
  for (let i = 0; i < batches.length; i++) {
    console.log(`[sample] Batch ${i + 1}/${batches.length} (${batches[i].length} jobs)`)
    const labels = await judgeBatch(batches[i])
    all.push(...labels)
  }

  const byJob = new Map(all.map((l) => [l.job_id, l] as const))
  const aiRelevant = all.filter((l) => l.is_ai_relevant)
  const notAi = all.filter((l) => !l.is_ai_relevant)

  console.log('\n' + '='.repeat(60))
  console.log(`  Sample size:           ${rows.length}`)
  console.log(`  Judged:                ${all.length}`)
  console.log(`  AI-relevant:           ${aiRelevant.length}  (${((aiRelevant.length / all.length) * 100).toFixed(1)}%)`)
  console.log(`  NOT AI-relevant:       ${notAi.length}  (${((notAi.length / all.length) * 100).toFixed(1)}%)`)
  console.log('='.repeat(60))

  const catCounts = new Map<string, number>()
  for (const l of aiRelevant) catCounts.set(l.category, (catCounts.get(l.category) ?? 0) + 1)
  console.log('\nCategory breakdown of AI-relevant subset:')
  const sorted = [...catCounts.entries()].sort((a, b) => b[1] - a[1])
  for (const [c, n] of sorted) console.log(`  ${c.padEnd(28)} ${n}`)

  console.log('\nSample of jobs judged NOT AI-relevant:')
  for (const l of notAi.slice(0, 15)) {
    const r = rows.find((x) => x.id === l.job_id)
    console.log(`  [${l.job_id}] ${r?.title} @ ${r?.company}`)
    console.log(`     → ${l.reason}`)
  }

  console.log('\nSample of jobs judged AI-relevant + category:')
  for (const l of aiRelevant.slice(0, 15)) {
    const r = rows.find((x) => x.id === l.job_id)
    console.log(`  [${l.job_id}] [${l.category}] ${r?.title} @ ${r?.company}`)
    console.log(`     → ${l.reason}`)
  }
}

main()
  .catch((err) => {
    console.error('failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
