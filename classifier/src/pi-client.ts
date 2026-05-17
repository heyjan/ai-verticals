/**
 * Pi.dev SDK wiring for the interactive analysis agent.
 *
 * Exports a single `sql` custom tool the agent uses to interrogate the
 * jobs database. The tool runs each query in its own read-only
 * transaction so the agent can't accidentally mutate state regardless
 * of what it asks for.
 */

import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import postgres, { type Sql } from 'postgres'

const MAX_ROWS = 200

const sqlParams = Type.Object({
  query: Type.String({
    description:
      'A single SQL query to run against the Postgres jobs database. ' +
      'Executed inside a READ ONLY transaction; INSERT/UPDATE/DELETE/DDL will fail. ' +
      `At most ${MAX_ROWS} rows are returned (add LIMIT to be safe).`,
  }),
})

function truncate(rows: Record<string, unknown>[]): {
  rows: Record<string, unknown>[]
  truncated: boolean
} {
  if (rows.length <= MAX_ROWS) return { rows, truncated: false }
  return { rows: rows.slice(0, MAX_ROWS), truncated: true }
}

export function createSqlTool(pgClient: Sql): ToolDefinition {
  return defineTool({
    name: 'sql',
    label: 'SQL',
    description:
      'Run a read-only SQL query against the jobs Postgres database. ' +
      'Schema: jobs(id, source, source_id, title, company, location, city, ' +
      'description, salary, job_level, posted_ago, contract_type, sector, url, ' +
      'category, first_seen_at, last_seen_at, created_at, updated_at); ' +
      'subcategories(id, category, name, keywords); ' +
      'tools(id, name, keywords); ' +
      'job_subcategories(job_id, subcategory_id); ' +
      'job_tools(job_id, tool_id); ' +
      'company_descriptions(id, company, description).',
    parameters: sqlParams,
    async execute(_toolCallId, params) {
      const query = params.query.trim()
      try {
        const rows = await pgClient.begin('read only', async (tx) => {
          const result = await tx.unsafe(query)
          return result as unknown as Record<string, unknown>[]
        })
        const { rows: shown, truncated } = truncate(rows)
        const payload = {
          rowCount: rows.length,
          truncated,
          rows: shown,
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(payload, null, 2),
            },
          ],
          details: payload,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [
            { type: 'text', text: `SQL error: ${message}` },
          ],
          details: { error: message },
        }
      }
    },
  })
}

/** Build a dedicated postgres client for the sql tool (separate pool, sane defaults). */
export function createReadonlyPg(): Sql {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return postgres(url, {
    max: 2,
    idle_timeout: 30,
    prepare: false,
  })
}
