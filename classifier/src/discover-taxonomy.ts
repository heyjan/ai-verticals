/**
 * Discover sub-segments + tools for each job category by sampling
 * descriptions and asking an LLM to label them.
 *
 * Writes into the Postgres `subcategories` and `tools` tables; the
 * previous contents of both are cleared in the same transaction so a
 * partial run can't leave the taxonomy half-stale.
 */

import { config } from 'dotenv'
import { db, pg, subcategories, tools } from '@ai-job-classifier/db'
import { sql } from 'drizzle-orm'
import OpenAI from 'openai'

config({ path: '.env' })

const apiKey = process.env.DEEPSEEK_API_KEY
if (!apiKey) {
  console.error('[discover] Missing DEEPSEEK_API_KEY in .env')
  process.exit(1)
}

const client = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey,
})

const SAMPLE_SIZE = 120
const DESC_CHAR_LIMIT = 400

interface SubSegmentResponse {
  subcategories: Array<{ name: string; keywords: string[] }>
  tools: Array<{ name: string; keywords: string[] }>
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function discoverForCategory(
  category: string,
  samples: Array<{ title: string; description: string }>,
): Promise<SubSegmentResponse | null> {
  const sampleText = samples
    .map((s, i) => {
      const desc = (s.description || '').slice(0, DESC_CHAR_LIMIT)
      return `${i + 1}. [${s.title}] ${desc}`
    })
    .join('\n')

  const res = await client.chat.completions.create({
    model: 'deepseek-chat',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a labor-market analyst. Given a set of job descriptions from one category, identify 4-6 distinct sub-segments (specialization areas) within that category and the most common tools/technologies/frameworks mentioned.

Respond with strict JSON:
{
  "subcategories": [
    { "name": "string (concise label)", "keywords": ["distinguishing keyword phrases", ...] }
  ],
  "tools": [
    { "name": "canonical tool/skill name", "keywords": ["variants/synonyms", ...] }
  ]
}

Rules:
- 4-6 subcategories per category, focused on specialization (not seniority).
- 6-12 tools, ordered by frequency observed.
- Keywords lowercase, distinctive (avoid generic terms like "team", "english").
- Tool keywords include common variants (e.g. "pytorch" -> ["pytorch", "torch"]).
- For sub-segment keywords, prefer 1-3 word phrases that appear in the descriptions.
- Subcategory names in English, concise (1-3 words).`,
      },
      {
        role: 'user',
        content: `Category: ${category}\n\nSample of ${samples.length} job listings (title + short summary):\n\n${sampleText}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 1500,
  })

  const content = res.choices[0]?.message?.content ?? '{}'
  try {
    return JSON.parse(content) as SubSegmentResponse
  } catch (err) {
    console.error(`[discover] LLM returned malformed JSON for "${category}":`, err)
    return null
  }
}

async function main(): Promise<void> {
  const categoryRows = await db.execute<{ category: string }>(
    sql`SELECT DISTINCT category FROM jobs WHERE category <> 'Other' ORDER BY category`,
  )
  if (!categoryRows.length) {
    console.log('[discover] No categories found.')
    return
  }
  const categories = categoryRows.map((r) => r.category)
  console.log(`[discover] Found ${categories.length} categories`)

  // Collect everything first so we can write atomically at the end.
  const newSubcategories: Array<{ category: string; name: string; keywords: string }> = []
  const newTools = new Map<string, string>() // tool name → keywords JSON (last wins)

  for (const category of categories) {
    console.log(`\n[discover] === ${category} ===`)

    const sampleRows = await db.execute<{ title: string; description: string }>(
      sql`SELECT title, description FROM jobs WHERE category = ${category} AND length(title) > 0`,
    )
    const allSamples = sampleRows.map((r) => ({
      title: r.title ?? '',
      description: r.description ?? '',
    }))
    if (!allSamples.length) {
      console.log(`[discover] No jobs for ${category}, skipping`)
      continue
    }
    const sample = shuffle(allSamples).slice(0, SAMPLE_SIZE)
    console.log(`[discover] Sampling ${sample.length}/${allSamples.length} jobs`)

    const result = await discoverForCategory(category, sample)
    if (!result) continue

    let subCount = 0
    for (const sub of result.subcategories ?? []) {
      if (!sub.name || !sub.keywords?.length) continue
      newSubcategories.push({
        category,
        name: sub.name,
        keywords: JSON.stringify(sub.keywords.map((k) => k.toLowerCase())),
      })
      subCount++
    }
    console.log(`[discover]   ${subCount} sub-segments`)

    let toolCount = 0
    for (const tool of result.tools ?? []) {
      if (!tool.name || !tool.keywords?.length) continue
      newTools.set(tool.name, JSON.stringify(tool.keywords.map((k) => k.toLowerCase())))
      toolCount++
    }
    console.log(`[discover]   ${toolCount} tools`)
  }

  console.log('\n[discover] Writing taxonomy in a single transaction')
  await db.transaction(async (tx) => {
    await tx.delete(subcategories)
    await tx.delete(tools)
    if (newSubcategories.length) await tx.insert(subcategories).values(newSubcategories)
    if (newTools.size) {
      await tx.insert(tools).values(
        Array.from(newTools, ([name, keywords]) => ({ name, keywords })),
      )
    }
  })

  console.log(`[discover] Done. ${newSubcategories.length} sub-segments, ${newTools.size} unique tools.`)
}

main()
  .catch((err) => {
    console.error('[discover] failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pg.end({ timeout: 5 })
  })
