/**
 * POST /api/waitlist
 *
 * Landing-page waitlist signup. Appends one JSON line per signup to
 * `.data/waitlist.jsonl` (same private `.data/` area the CV builder uses)
 * so there's no schema migration for what is effectively a lead list.
 */

import { mkdir, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: unknown }>(event)
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, message: 'Bitte eine gültige E-Mail-Adresse angeben.' })
  }

  const file = join('.data', 'waitlist.jsonl')
  await mkdir(dirname(file), { recursive: true })
  await appendFile(
    file,
    JSON.stringify({ email, at: new Date().toISOString() }) + '\n',
    'utf8',
  )

  return { ok: true }
})
