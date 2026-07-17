/**
 * POST /api/waitlist
 *
 * Landing-page waitlist signup. Appends one JSON line per signup to
 * `.data/waitlist.jsonl` (same private `.data/` area the CV builder uses)
 * so there's no schema migration for what is effectively a lead list, then
 * emails a notification if SMTP is configured. Recording the signup is the
 * source of truth; a mail failure must never lose the lead, so send errors
 * are swallowed after logging.
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

  const at = new Date().toISOString()
  const file = join('.data', 'waitlist.jsonl')
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, JSON.stringify({ email, at }) + '\n', 'utf8')

  await notify(email, at)

  return { ok: true }
})

/**
 * Fire the signup notification. Best-effort: any transport error is logged
 * and swallowed so the request still succeeds and the lead stays recorded.
 */
async function notify(email: string, at: string): Promise<void> {
  const mailer = getMailer()
  if (!mailer) return

  const { waitlistNotifyTo } = useRuntimeConfig()
  try {
    await mailer.sendMail({
      from: mailFrom(),
      to: waitlistNotifyTo,
      replyTo: email,
      subject: `Neue Waitlist-Anmeldung: ${email}`,
      text: `${email} hat sich am ${at} für die ai-verticals Waitlist eingetragen.`,
    })
  } catch (err) {
    console.error('[waitlist] notification email failed:', err)
  }
}
