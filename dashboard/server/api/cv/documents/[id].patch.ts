import { cvDocuments, type CvDocumentContent, type CvPageSettings } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import { requireCvBuilderUser, sanitizeCvPageSettings } from '../../../utils/cv-builder'
import { materializeCvDocumentContent, resolveCvTemplate, sanitizeCvSlotAssignments } from '../../../utils/cv-editor'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid document id' })
  }

  const body = await readBody<{
    title?: string
    templateId?: string
    content?: CvDocumentContent
    themeOverrides?: Record<string, unknown>
    page?: CvPageSettings
    slotAssignments?: unknown
  }>(event)

  const updates: Partial<typeof cvDocuments.$inferInsert> = {}
  if (typeof body.title === 'string') updates.title = body.title.trim() || 'Untitled CV'
  if (body.content?.type === 'doc') updates.content = body.content
  if (body.themeOverrides && typeof body.themeOverrides === 'object') updates.themeOverrides = body.themeOverrides
  if (body.page?.size && body.page.margin) updates.page = sanitizeCvPageSettings(body.page)

  const wantsTemplateChange = typeof body.templateId === 'string' && body.templateId.length > 0
  const wantsAssignments = body.slotAssignments !== undefined

  if (wantsTemplateChange || wantsAssignments) {
    const [existing] = await db
      .select({ templateId: cvDocuments.templateId, slotAssignments: cvDocuments.slotAssignments })
      .from(cvDocuments)
      .where(and(eq(cvDocuments.id, id), eq(cvDocuments.userId, user.id)))
      .limit(1)
    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }

    const targetTemplateId = wantsTemplateChange ? body.templateId! : existing.templateId
    const template = await resolveCvTemplate(user.id, targetTemplateId)
    if (!template) {
      throw createError({ statusCode: 400, statusMessage: 'Unknown template' })
    }

    if (wantsTemplateChange && template.id !== existing.templateId) {
      updates.templateId = template.id
      // Adopt the new template's page setup unless the request pins its own.
      if (!body.page?.size) updates.page = sanitizeCvPageSettings(template.page)
    }

    const assignments = wantsAssignments
      ? sanitizeCvSlotAssignments(body.slotAssignments)
      : existing.slotAssignments
    if (wantsAssignments) updates.slotAssignments = assignments

    // Keep `content` as the materialized skeleton: existing assignments carry
    // over to the new template's slots (matched by slot name); a document
    // without any assignments adopts the raw skeleton so its slots show up.
    if (assignments) {
      const materialized = await materializeCvDocumentContent(user.id, template.id, assignments)
      if (materialized) updates.content = materialized
    } else if (updates.templateId) {
      updates.content = template.skeleton
    }
  }

  if (!Object.keys(updates).length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid document changes' })
  }

  const [document] = await db
    .update(cvDocuments)
    .set(updates)
    .where(and(eq(cvDocuments.id, id), eq(cvDocuments.userId, user.id)))
    .returning()

  if (!document) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  return { document }
})
