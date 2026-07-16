/**
 * Shared SMTP transport for transactional mail.
 *
 * The transporter is created lazily and memoised across requests. When no
 * SMTP host is configured (typical in local dev) `getMailer()` returns null
 * and callers are expected to skip sending rather than fail.
 */

import nodemailer, { type Transporter } from 'nodemailer'

let cached: Transporter | null | undefined

export function getMailer(): Transporter | null {
  if (cached !== undefined) return cached

  const { smtp } = useRuntimeConfig()
  if (!smtp.host) {
    cached = null
    return cached
  }

  cached = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  })
  return cached
}

export function mailFrom(): string {
  return useRuntimeConfig().smtp.from
}
