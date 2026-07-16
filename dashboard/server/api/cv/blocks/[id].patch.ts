import { cvTextBlocks } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import { requireCvBuilderUser } from '../../../utils/cv-builder'
import { isCvDocContent, sanitizeCvTags, sanitizeCvTextBlockKind } from '../../../utils/cv-editor'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid text block id' })
  }

  const body = await readBody<{
    label?: string
    kind?: string
    content?: unknown
    tags?: unknown
  }>(event)

  const updates: Partial<typeof cvTextBlocks.$inferInsert> = {}
  if (typeof body.label === 'string' && body.label.trim()) updates.label = body.label.trim()
  if (typeof body.kind === 'string') updates.kind = sanitizeCvTextBlockKind(body.kind)
  if (isCvDocContent(body.content)) updates.content = body.content
  if (body.tags !== undefined) updates.tags = sanitizeCvTags(body.tags)

  if (!Object.keys(updates).length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid text block changes' })
  }

  const [block] = await db
    .update(cvTextBlocks)
    .set(updates)
    .where(and(eq(cvTextBlocks.id, id), eq(cvTextBlocks.userId, user.id)))
    .returning()

  if (!block) {
    throw createError({ statusCode: 404, statusMessage: 'Text block not found' })
  }

  return { block }
})
