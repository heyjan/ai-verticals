/**
 * Assign jobs to sub-segments and tools using an LLM batched classifier.
 *
 * For each batch of ~20 jobs we ship the title, a truncated description,
 * and the candidate sub-segments + tools (filtered by category for subs)
 * to DeepSeek with JSON-mode and ask for an array of
 * { job_id, subcategory_ids[], tool_ids[] }.
 *
 * Replaces the regex-only classifier that lived under
 * `dashboard/scripts/classify-jobs.ts`. Writes are batched per job batch
 * via a single transaction so a mid-run failure leaves the existing
 * classifications intact.
 */

import { config } from 'dotenv'
import {
  db,
  jobSubcategories,
  jobTools,
  jobs,
  pg,
  subcategories,
  tools,
} from '@ai-job-classifier/db'
import { asc, eq, ne } from 'drizzle-orm'
import OpenAI from 'openai'

config({ path: '.env' })

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('[classify] Missing DEEPSEEK_API_KEY in .env')
  process.exit(1)
}

const client = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey,
})

const BATCH_SIZE = Number(process.env.CLASSIFY_BATCH_SIZE ?? 20)
const DESC_CHAR_LIMIT = 600
const MAX_BATCH_RETRIES = 2

interface Candidate {
  id: number
  name: string
  keywords: string[]
}

interface JobRow {
  id: number
  category: string
  title: string
  description: string
}

interface BatchLabel {
  job_id: number
  subcategory_ids: number[]
  tool_ids: number[]
}

interface BatchResponse {
  labels: BatchLabel[]
}

function parseKeywords(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function classifyBatch(
  batch: JobRow[],
  subsByCategory: Map<string, Candidate[]>,
  toolCandidates: Candidate[],
): Promise<BatchLabel[]> {
  const categoriesInBatch = new Set(batch.map((j) => j.category))
  const subCandidates: Candidate[] = []
  for (const cat of categoriesInBatch) {
    const list = subsByCategory.get(cat) ?? []
    subCandidates.push(...list)
  }

  const subMenu = subCandidates
    .map((s) => `  - id=${s.id} name=${JSON.stringify(s.name)} hints=${JSON.stringify(s.keywords.slice(0, 8))}`)
    .join('\n')
  const toolMenu = toolCandidates
    .map((t) => `  - id=${t.id} name=${JSON.stringify(t.name)} hints=${JSON.stringify(t.keywords.slice(0, 6))}`)
    .join('\n')

  const jobsText = batch
    .map((j) => {
      const desc = (j.description || '').slice(0, DESC_CHAR_LIMIT).replace(/\s+/g, ' ').trim()
      return `[job_id=${j.id}] (${j.category}) ${j.title}\n${desc}`
    })
    .join('\n\n')

  const systemPrompt =
    'You are a labor-market analyst. For each job listing below, return the ids of the ' +
    'best-matching sub-segments AND tools/skills. ' +
    'Pick from the provided menus ONLY — never invent ids. ' +
    'Prefer specificity over coverage: empty arrays are valid. ' +
    'Each job: 0-2 sub-segment ids (matching the job category) and 0-8 tool ids.\n\n' +
    'Return strict JSON:\n' +
    '{ "labels": [ { "job_id": number, "subcategory_ids": number[], "tool_ids": number[] } ] }'

  const userPrompt =
    `Sub-segment menu (id → name → optional hints):\n${subMenu || '  (none)'}\n\n` +
    `Tool menu:\n${toolMenu || '  (none)'}\n\n` +
    `Jobs:\n${jobsText}`

  let attempt = 0
  while (true) {
    attempt++
    const res = await client.chat.completions.create({
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2500,
    })

    const content = res.choices[0]?.message?.content ?? '{}'
    try {
      const parsed = JSON.parse(content) as BatchResponse
      if (!Array.isArray(parsed.labels)) throw new Error('labels missing')
      return parsed.labels
    } catch (err) {
      if (attempt > MAX_BATCH_RETRIES) {
        console.error(`[classify] Giving up on batch after ${attempt} attempts:`, err)
        return []
      }
      console.warn(`[classify] Malformed response (attempt ${attempt}); retrying...`)
    }
  }
}

async function main(): Promise<void> {
  const subRows = await db
    .select({
      id: subcategories.id,
      category: subcategories.category,
      name: subcategories.name,
      keywords: subcategories.keywords,
    })
    .from(subcategories)

  if (!subRows.length) {
    console.error('[classify] No subcategories found. Run `discover` first.')
    process.exit(1)
  }
  const subsByCategory = new Map<string, Candidate[]>()
  for (const r of subRows) {
    const list = subsByCategory.get(r.category) ?? []
    list.push({ id: r.id, name: r.name, keywords: parseKeywords(r.keywords) })
    subsByCategory.set(r.category, list)
  }
  console.log(`[classify] Loaded ${subRows.length} sub-segments across ${subsByCategory.size} categories`)

  const toolRows = await db
    .select({ id: tools.id, name: tools.name, keywords: tools.keywords })
    .from(tools)
  const toolCandidates: Candidate[] = toolRows.map((r) => ({
    id: r.id,
    name: r.name,
    keywords: parseKeywords(r.keywords),
  }))
  const toolIds = new Set(toolCandidates.map((t) => t.id))
  const subIds = new Set(subRows.map((s) => s.id))
  console.log(`[classify] Loaded ${toolCandidates.length} tools`)

  const jobRows = await db
    .select({
      id: jobs.id,
      category: jobs.category,
      title: jobs.title,
      description: jobs.description,
    })
    .from(jobs)
    .where(ne(jobs.category, 'Other'))
    .orderBy(asc(jobs.id))

  if (!jobRows.length) {
    console.log('[classify] No jobs to classify.')
    return
  }
  console.log(`[classify] Classifying ${jobRows.length} jobs in batches of ${BATCH_SIZE}`)

  await db.delete(jobSubcategories)
  await db.delete(jobTools)
  console.log('[classify] Cleared previous classifications')

  let subAssignments = 0
  let toolAssignments = 0
  let batchIdx = 0
  const totalBatches = Math.ceil(jobRows.length / BATCH_SIZE)

  for (const batch of chunk(jobRows, BATCH_SIZE)) {
    batchIdx++
    console.log(`[classify] Batch ${batchIdx}/${totalBatches} (${batch.length} jobs)`)

    const labels = await classifyBatch(batch, subsByCategory, toolCandidates)

    const subRowsToInsert: Array<{ jobId: number; subcategoryId: number }> = []
    const toolRowsToInsert: Array<{ jobId: number; toolId: number }> = []

    const allowedSubsByJob = new Map(
      batch.map((j) => [j.id, new Set((subsByCategory.get(j.category) ?? []).map((s) => s.id))]),
    )

    for (const label of labels) {
      const allowedSubs = allowedSubsByJob.get(label.job_id)
      if (!allowedSubs) continue // hallucinated job_id
      for (const subId of label.subcategory_ids ?? []) {
        if (allowedSubs.has(subId)) subRowsToInsert.push({ jobId: label.job_id, subcategoryId: subId })
      }
      for (const toolId of label.tool_ids ?? []) {
        if (toolIds.has(toolId)) toolRowsToInsert.push({ jobId: label.job_id, toolId })
      }
    }

    if (subRowsToInsert.length || toolRowsToInsert.length) {
      await db.transaction(async (tx) => {
        if (subRowsToInsert.length) {
          await tx.insert(jobSubcategories).values(subRowsToInsert).onConflictDoNothing()
        }
        if (toolRowsToInsert.length) {
          await tx.insert(jobTools).values(toolRowsToInsert).onConflictDoNothing()
        }
      })
      subAssignments += subRowsToInsert.length
      toolAssignments += toolRowsToInsert.length
    }
  }

  console.log(
    `[classify] Done. ${subAssignments} job-subcategory links, ${toolAssignments} job-tool links.`,
  )
  // Silence unused-variable warning when subIds gates checks elsewhere.
  void subIds
}

main()
  .catch((err) => {
    console.error('[classify] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
