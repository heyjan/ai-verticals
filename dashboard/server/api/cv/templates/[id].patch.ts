import { cvTemplates as cvTemplateRows, type CvPageSettings } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import { requireCvBuilderUser, sanitizeCvPageSettings } from '../../../utils/cv-builder'
import { isBuiltinCvTemplateId, isCvDocContent, sanitizeCvTemplateLayout } from '../../../utils/cv-editor'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid template id' })
  }
  if (isBuiltinCvTemplateId(id)) {
    throw createError({ statusCode: 403, statusMessage: 'Built-in templates cannot be edited; clone them first' })
  }

  const body = await readBody<{
    name?: string
    layout?: string
    theme?: Record<string, unknown>
    page?: CvPageSettings
    skeleton?: unknown
  }>(event)

  const updates: Partial<typeof cvTemplateRows.$inferInsert> = {}
  if (typeof body.name === 'string') updates.name = body.name.trim() || 'Untitled Template'
  if (typeof body.layout === 'string') updates.layout = sanitizeCvTemplateLayout(body.layout)
  if (body.theme && typeof body.theme === 'object') updates.theme = body.theme
  if (body.page?.size && body.page.margin) updates.page = sanitizeCvPageSettings(body.page)
  if (isCvDocContent(body.skeleton)) updates.skeleton = body.skeleton

  if (!Object.keys(updates).length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid template changes' })
  }

  const [template] = await db
    .update(cvTemplateRows)
    .set(updates)
    .where(and(eq(cvTemplateRows.id, id), eq(cvTemplateRows.userId, user.id)))
    .returning()

  if (!template) {
    throw createError({ statusCode: 404, statusMessage: 'Template not found' })
  }

  return { template }
})
