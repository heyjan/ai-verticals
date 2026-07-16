import { cvTemplates as cvTemplateRows } from '@ai-job-classifier/db'

import { requireCvBuilderUser, sanitizeCvPageSettings } from '../../../utils/cv-builder'
import { newCvTemplateId, resolveCvTemplate } from '../../../utils/cv-editor'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const body = await readBody<{ name?: string; cloneFromId?: string }>(event)

  const source = await resolveCvTemplate(user.id, body.cloneFromId || 'tmpl_classic_single_col')
  if (!source) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown source template' })
  }

  const [created] = await db
    .insert(cvTemplateRows)
    .values({
      id: newCvTemplateId(),
      userId: user.id,
      name: body.name?.trim() || `${source.name} Copy`,
      layout: source.layout,
      theme: source.theme as unknown as Record<string, unknown>,
      page: sanitizeCvPageSettings(source.page),
      skeleton: source.skeleton,
    })
    .returning()

  return { template: created }
})
