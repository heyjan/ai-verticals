import { cvTextBlocks } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import { requireCvBuilderUser } from '../../../utils/cv-builder'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid text block id' })
  }

  const [deleted] = await db
    .delete(cvTextBlocks)
    .where(and(eq(cvTextBlocks.id, id), eq(cvTextBlocks.userId, user.id)))
    .returning({ id: cvTextBlocks.id })

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Text block not found' })
  }

  return { ok: true }
})
