/**
 * Long-running pi.dev interactive session.
 *
 * Boots an agent with no built-in coding tools and one custom `sql`
 * tool that talks to the jobs Postgres database. Reads user prompts
 * from stdin in a line-by-line loop; streams the agent's text output
 * back to stdout.
 *
 * Intended to run inside the `classifier-agent` compose service via
 * `docker compose attach classifier-agent`.
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import {
  createAgentSession,
  SessionManager,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'

import { createReadonlyPg, createSqlTool } from './pi-client.ts'

const COMPACT_EVERY = Number(process.env.PI_COMPACT_EVERY_TURNS ?? 20)

async function main(): Promise<void> {
  const pgClient = createReadonlyPg()
  const sqlTool = createSqlTool(pgClient)

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    noTools: 'builtin',
    customTools: [sqlTool],
  })

  let inAssistantText = false
  let userTurnCount = 0
  let inFlight = false
  let resolveTurn: (() => void) | null = null

  const onEvent = (event: AgentSessionEvent): void => {
    switch (event.type) {
      case 'message_update': {
        const msg = event.assistantMessageEvent
        if (msg.type === 'text_delta') {
          if (!inAssistantText) {
            stdout.write('\n')
            inAssistantText = true
          }
          stdout.write(msg.delta)
        } else if (msg.type === 'text_end') {
          stdout.write('\n')
          inAssistantText = false
        }
        break
      }
      case 'tool_execution_start':
        stdout.write(`\n[tool: ${event.toolName}] running...\n`)
        break
      case 'tool_execution_end':
        if (event.isError) stdout.write(`[tool: ${event.toolName}] error\n`)
        else stdout.write(`[tool: ${event.toolName}] done\n`)
        break
      case 'turn_end':
        if (resolveTurn) {
          const r = resolveTurn
          resolveTurn = null
          r()
        }
        break
    }
  }

  const unsubscribe = session.subscribe(onEvent)

  const cleanup = async (code = 0): Promise<void> => {
    unsubscribe()
    try { await session.abort() } catch {}
    try { session.dispose() } catch {}
    try { await pgClient.end({ timeout: 5 }) } catch {}
    process.exit(code)
  }

  process.on('SIGINT', () => { void cleanup(130) })
  process.on('SIGTERM', () => { void cleanup(143) })

  const rl = createInterface({ input: stdin, output: stdout })

  stdout.write(
    'Pi.dev interactive job-data agent.\n' +
    'Ask questions about the dataset; the agent will call the `sql` tool against Postgres.\n' +
    'Examples:\n' +
    '  > how many pytorch jobs in Berlin posted in the last 7 days?\n' +
    '  > top 5 companies by Data Science role count\n' +
    'Press Ctrl-C to exit.\n',
  )

  while (true) {
    if (!inFlight) stdout.write('\n> ')
    const line = (await rl.question('')).trim()
    if (!line) continue
    if (line === '/exit' || line === '/quit') break

    inFlight = true
    inAssistantText = false
    const turn = new Promise<void>((resolve) => { resolveTurn = resolve })
    void session.prompt(line).catch((err) => {
      stdout.write(`\n[agent error: ${err instanceof Error ? err.message : String(err)}]\n`)
      if (resolveTurn) { const r = resolveTurn; resolveTurn = null; r() }
    })
    await turn
    inFlight = false

    userTurnCount++
    if (userTurnCount % COMPACT_EVERY === 0) {
      try {
        stdout.write('\n[compacting context...]\n')
        await session.compact()
      } catch (err) {
        stdout.write(`[compaction failed: ${err instanceof Error ? err.message : String(err)}]\n`)
      }
    }
  }

  await cleanup(0)
}

main().catch((err) => {
  console.error('[interactive] fatal:', err)
  process.exit(1)
})
