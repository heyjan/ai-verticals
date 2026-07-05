/**
 * GET /api/knowledge-graph
 *
 * Returns a three-level hierarchy as graph data:
 *   - L1: job categories
 *   - L2: sub-segments per category
 *   - L3: top tools/skills (with co-occurrence edges to subcategories)
 */

import { jobSubcategories, jobTools, jobs, subcategories, tools } from '@ai-job-classifier/db'
import { and, count, desc, eq, ne, sql } from 'drizzle-orm'

import { db } from '../utils/db'

interface GraphNode {
  id: string
  label: string
  level: 1 | 2 | 3
  count: number
  parent?: string
}

interface GraphEdge {
  source: string
  target: string
  kind: 'hierarchy' | 'cooccurrence'
  weight: number
}

const TOP_TOOLS_LIMIT = 40
const MIN_EDGE_WEIGHT = 3

export default defineEventHandler(async () => {
  const catRows = await db
    .select({ category: jobs.category, cnt: count() })
    .from(jobs)
    .where(and(ne(jobs.category, 'Other'), eq(jobs.active, true)))
    .groupBy(jobs.category)
    .orderBy(desc(count()))

  const categories: GraphNode[] = catRows.map((r) => ({
    id: `cat:${r.category}`,
    label: r.category,
    level: 1,
    count: r.cnt,
  }))

  // Count only associations to *active* jobs: join through to jobs with an
  // active=true condition and count jobs.id (null for soft-deleted rows, so
  // they drop out). The outer LEFT JOINs keep zero-count subcategories.
  const subRows = await db
    .select({
      id: subcategories.id,
      category: subcategories.category,
      name: subcategories.name,
      cnt: count(jobs.id),
    })
    .from(subcategories)
    .leftJoin(jobSubcategories, eq(jobSubcategories.subcategoryId, subcategories.id))
    .leftJoin(jobs, and(eq(jobs.id, jobSubcategories.jobId), eq(jobs.active, true)))
    .groupBy(subcategories.id)
    .orderBy(desc(count(jobs.id)))

  const subs = subRows.map((r) => ({
    dbId: r.id,
    id: `sub:${r.id}`,
    label: r.name,
    level: 2 as const,
    count: r.cnt,
    parent: `cat:${r.category}`,
  }))

  const toolRows = await db
    .select({
      id: tools.id,
      name: tools.name,
      cnt: count(jobs.id),
    })
    .from(tools)
    .leftJoin(jobTools, eq(jobTools.toolId, tools.id))
    .leftJoin(jobs, and(eq(jobs.id, jobTools.jobId), eq(jobs.active, true)))
    .groupBy(tools.id)
    .having(sql`count(${jobs.id}) > 0`)
    .orderBy(desc(count(jobs.id)))
    .limit(TOP_TOOLS_LIMIT)

  const toolList = toolRows.map((r) => ({
    dbId: r.id,
    id: `tool:${r.id}`,
    label: r.name,
    level: 3 as const,
    count: r.cnt,
  }))

  const edges: GraphEdge[] = []
  for (const sub of subs) {
    if (sub.parent) {
      edges.push({ source: sub.parent, target: sub.id, kind: 'hierarchy', weight: sub.count })
    }
  }

  if (subs.length && toolList.length) {
    const subIds = subs.map((s) => s.dbId)
    const toolIds = toolList.map((t) => t.dbId)

    // Inline the IDs as Postgres array literals via sql.raw. Drizzle's `sql`
    // template expands a JS array as a record `(1,2,…)`, not an array, so
    // `${arr}::int[]` fails with "cannot cast type record to integer[]".
    // The IDs are our own integer PKs, so direct interpolation is safe.
    const subIdsLit = sql.raw(`ARRAY[${subIds.join(',')}]::int[]`)
    const toolIdsLit = sql.raw(`ARRAY[${toolIds.join(',')}]::int[]`)

    const coRows = await db
      .select({
        subcategoryId: jobSubcategories.subcategoryId,
        toolId: jobTools.toolId,
        shared: count(),
      })
      .from(jobSubcategories)
      .innerJoin(jobTools, eq(jobTools.jobId, jobSubcategories.jobId))
      .innerJoin(jobs, and(eq(jobs.id, jobSubcategories.jobId), eq(jobs.active, true)))
      .where(and(
        sql`${jobSubcategories.subcategoryId} = ANY(${subIdsLit})`,
        sql`${jobTools.toolId} = ANY(${toolIdsLit})`,
      ))
      .groupBy(jobSubcategories.subcategoryId, jobTools.toolId)
      .having(sql`count(*) >= ${MIN_EDGE_WEIGHT}`)

    for (const r of coRows) {
      edges.push({
        source: `sub:${r.subcategoryId}`,
        target: `tool:${r.toolId}`,
        kind: 'cooccurrence',
        weight: r.shared,
      })
    }
  }

  const connectedToolIds = new Set<string>()
  for (const e of edges) {
    if (e.kind === 'cooccurrence') connectedToolIds.add(e.target)
  }
  const filteredTools = toolList.filter((t) => connectedToolIds.has(t.id))

  const nodes: GraphNode[] = [
    ...categories,
    ...subs.map(({ dbId: _, ...rest }) => rest),
    ...filteredTools.map(({ dbId: _, ...rest }) => rest),
  ]

  return { nodes, edges }
})
