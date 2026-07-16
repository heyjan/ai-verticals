import { cvDocuments } from '@ai-job-classifier/db'

import { requireCvBuilderUser } from '../../../utils/cv-builder'
import { createDocumentFromResolvedTemplate, resolveCvTemplate } from '../../../utils/cv-editor'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const body = await readBody<{ templateId?: string; title?: string }>(event)
  const template = await resolveCvTemplate(user.id, body.templateId || 'tmpl_classic_single_col')
  if (!template) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown template' })
  }

  const document = createDocumentFromResolvedTemplate(template, body.title)
  const [created] = await db
    .insert(cvDocuments)
    .values({ userId: user.id, ...document })
    .returning()

  return { document: created }
})
