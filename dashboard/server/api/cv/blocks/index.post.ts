import { cvTextBlocks } from '@ai-job-classifier/db'

import { requireCvBuilderUser } from '../../../utils/cv-builder'
import { isCvDocContent, sanitizeCvTags, sanitizeCvTextBlockKind } from '../../../utils/cv-editor'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const body = await readBody<{
    label?: string
    kind?: string
    content?: unknown
    tags?: unknown
  }>(event)

  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) {
    throw createError({ statusCode: 400, statusMessage: 'Text block label is required' })
  }
  if (!isCvDocContent(body.content)) {
    throw createError({ statusCode: 400, statusMessage: 'Text block content must be a TipTap doc' })
  }

  const [created] = await db
    .insert(cvTextBlocks)
    .values({
      userId: user.id,
      label,
      kind: sanitizeCvTextBlockKind(body.kind),
      content: body.content,
      tags: sanitizeCvTags(body.tags),
    })
    .returning()

  return { block: created }
})
