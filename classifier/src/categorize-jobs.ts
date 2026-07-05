/**
 * Assign top-level category to jobs landing as 'Other' via DeepSeek, and
 * drop genuinely-non-AI listings that leaked through the regex pre-filter
 * in `scrapers/clean.py`.
 *
 * Runs between `import` and `classify` in the daily pipeline so the
 * subcategory pass in classify-jobs.ts (which skips category='Other')
 * actually sees the new jobs.
 *
 * Set REJECT_THRESHOLD=0 (or any false-y) to disable deletions and only
 * write categories.
 */

import { config } from 'dotenv'
import { db, jobs, pg } from '@ai-job-classifier/db'
import { eq, inArray, sql } from 'drizzle-orm'
import OpenAI from 'openai'

config({ path: '.env' })

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('[categorize] Missing DEEPSEEK_API_KEY in .env')
  process.exit(1)
}

const client = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey,
})

export const CATEGORIES = [
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

const CATEGORY_SET = new Set<string>(CATEGORIES)

const BATCH_SIZE = Number(process.env.CATEGORIZE_BATCH_SIZE ?? 20)
const DESC_CHAR_LIMIT = 600
const MAX_BATCH_RETRIES = 2
// If false, we keep all rows and only update category. If true, rows judged
// is_ai_relevant=false are deleted from the jobs table.
const ENABLE_REJECT = (process.env.CATEGORIZE_REJECT ?? '1') !== '0'

interface JobRow {
  id: number
  title: string
  description: string
  company: string
}

interface Label {
  job_id: number
  is_ai_relevant: boolean
  category: string
}

interface BatchResponse {
  labels: Label[]
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const SYSTEM_PROMPT =
  'You are a labor-market analyst classifying job listings scraped from LinkedIn/Glassdoor/Xing ' +
  'in Germany using AI-related search queries (AI, LLM, NLP, AI Agent, MLOps, OpenAI, RAG, ' +
  'Künstliche Intelligenz).\n\n' +
  'TITLES ARE DECISIVE. If the title contains any of: AI, KI, Künstliche Intelligenz, ML, ' +
  'machine learning, LLM, NLP, AI agent, MLOps, OpenAI, RAG, generative AI, computer vision, ' +
  'data scientist, deep learning, prompt engineer — mark is_ai_relevant=true. This includes ' +
  'AI-adjacent roles: "AI Sales", "AI Strategy Manager", "AI Consultant", "AI Support Specialist", ' +
  '"AI Product Manager", "KI-Trainee", "Open AI position", etc. In German, "KI" in a job title ' +
  'ALWAYS means Künstliche Intelligenz; never interpret it as a region code or other abbreviation.\n\n' +
  'Only set is_ai_relevant=false when BOTH the title lacks any AI/ML keyword AND the description ' +
  'contains no substantive AI/ML signal. Concrete false cases: claims adjusters / Bauingenieure / ' +
  'Schadenregulierer whose title mentions a region that happens to abbreviate to KI; survey ' +
  'participants ("Survey Participant"); training programs ABOUT AI for end-users ("Werde Fachkraft ' +
  'für KI-Integration"); generic SAP/Salesforce/creative-marketing roles at companies that ' +
  'happen to use AI; Bachelorand/Werkstudent positions with no AI scope in title or body.\n\n' +
  'For each listing return:\n' +
  '  1. is_ai_relevant: boolean (per rules above)\n' +
  `  2. category: ONE of ${CATEGORIES.map((c) => `"${c}"`).join(', ')}. ` +
  'Pick by ROLE, not company. Sales roles selling AI products → "Sales/Marketing". ' +
  'Strategy/consulting roles in AI → "Consulting" or "Management" depending on seniority. ' +
  'Engineering roles building AI → "Engineering/Development" or "Data Science/ML". ' +
  'Use "Other" only when no category fits. If is_ai_relevant is false, set category to "Other".\n\n' +
  'Return strict JSON: { "labels": [ { "job_id": number, "is_ai_relevant": boolean, "category": string } ] }'

async function categorizeBatch(batch: JobRow[]): Promise<Label[]> {
  const jobsText = batch
    .map((j) => {
      const desc = (j.description || '').slice(0, DESC_CHAR_LIMIT).replace(/\s+/g, ' ').trim()
      return `[job_id=${j.id}] ${j.title} @ ${j.company}\n${desc}`
    })
    .join('\n\n')

  let attempt = 0
  while (true) {
    attempt++
    const res = await client.chat.completions.create({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Jobs:\n${jobsText}` },
      ],
      temperature: 0.1,
      max_tokens: 3000,
    })

    const content = res.choices[0]?.message?.content ?? '{}'
    try {
      const parsed = JSON.parse(content) as BatchResponse
      if (!Array.isArray(parsed.labels)) throw new Error('labels missing')
      return parsed.labels
    } catch (err) {
      if (attempt > MAX_BATCH_RETRIES) {
        console.error(`[categorize] Giving up on batch after ${attempt} attempts:`, err)
        return []
      }
      console.warn(`[categorize] Malformed response (attempt ${attempt}); retrying...`)
    }
  }
}

async function main(): Promise<void> {
  const rows = (await db.execute(
    sql`SELECT id, title, description, company FROM jobs WHERE category = 'Other' ORDER BY id`,
  )) as unknown as JobRow[]

  if (!rows.length) {
    console.log('[categorize] No jobs with category=Other. Nothing to do.')
    return
  }
  console.log(`[categorize] Processing ${rows.length} jobs (batch size ${BATCH_SIZE}, reject=${ENABLE_REJECT})`)

  const batches = chunk(rows, BATCH_SIZE)
  let totalCategorized = 0
  let totalRejected = 0
  let totalSkipped = 0
  const categoryCounts = new Map<string, number>()
  // Rejected rows get deleted; keep title/company so we can log a sample for
  // spot-checking the non-AI filter after the fact.
  const rejectedRows: JobRow[] = []

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    process.stdout.write(`[categorize] Batch ${i + 1}/${batches.length} (${batch.length} jobs)... `)
    const labels = await categorizeBatch(batch)

    const byId = new Map(labels.map((l) => [l.job_id, l] as const))
    const updatesByCategory = new Map<string, number[]>()
    const toReject: number[] = []

    for (const job of batch) {
      const lbl = byId.get(job.id)
      if (!lbl) {
        totalSkipped++
        continue
      }
      if (ENABLE_REJECT && !lbl.is_ai_relevant) {
        toReject.push(job.id)
        rejectedRows.push(job)
        continue
      }
      const cat = CATEGORY_SET.has(lbl.category) ? lbl.category : 'Other'
      const list = updatesByCategory.get(cat) ?? []
      list.push(job.id)
      updatesByCategory.set(cat, list)
    }

    await db.transaction(async (tx) => {
      for (const [cat, ids] of updatesByCategory) {
        if (!ids.length) continue
        await tx.update(jobs).set({ category: cat, updatedAt: new Date() }).where(inArray(jobs.id, ids))
        totalCategorized += ids.length
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + ids.length)
      }
      if (toReject.length) {
        await tx.delete(jobs).where(inArray(jobs.id, toReject))
        totalRejected += toReject.length
      }
    })

    process.stdout.write(`updated=${[...updatesByCategory.values()].reduce((a, b) => a + b.length, 0)} rejected=${toReject.length}\n`)
  }

  console.log('\n' + '='.repeat(60))
  console.log(`  Total processed:    ${rows.length}`)
  console.log(`  Categorized:        ${totalCategorized}`)
  console.log(`  Rejected (not AI):  ${totalRejected}`)
  console.log(`  Skipped (no label): ${totalSkipped}`)
  console.log('='.repeat(60))
  console.log('\nCategory assignments:')
  for (const [c, n] of [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(28)} ${n}`)
  }

  // Log up to 10 random rejected jobs so the non-AI filter can be spot-checked.
  if (rejectedRows.length) {
    const sample = [...rejectedRows].sort(() => Math.random() - 0.5).slice(0, 10)
    console.log(`\nSample of ${sample.length} (of ${rejectedRows.length}) jobs dropped as non-AI:`)
    for (const j of sample) {
      console.log(`  [${j.id}] ${j.title} @ ${j.company}`)
    }
  }
}

main()
  .catch((err) => {
    console.error('[categorize] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
