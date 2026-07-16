import { cvTemplates as cvTemplateRows } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import { requireCvBuilderUser } from '../../../utils/cv-builder'
import { countDocumentsUsingTemplate, isBuiltinCvTemplateId } from '../../../utils/cv-editor'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid template id' })
  }
  if (isBuiltinCvTemplateId(id)) {
    throw createError({ statusCode: 403, statusMessage: 'Built-in templates cannot be deleted' })
  }

  const documentsUsingTemplate = await countDocumentsUsingTemplate(user.id, id)
  if (documentsUsingTemplate > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `Template is used by ${documentsUsingTemplate} document(s) and cannot be deleted`,
    })
  }

  const [deleted] = await db
    .delete(cvTemplateRows)
    .where(and(eq(cvTemplateRows.id, id), eq(cvTemplateRows.userId, user.id)))
    .returning({ id: cvTemplateRows.id })

  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Template not found' })
  }

  return { ok: true }
})
