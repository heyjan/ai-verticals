import { cvDocuments, cvFiles } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import { removeStoredCvFiles, requireCvBuilderUser } from '../../../utils/cv-builder'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid document id' })
  }

  const [document] = await db
    .select({ id: cvDocuments.id })
    .from(cvDocuments)
    .where(and(eq(cvDocuments.id, id), eq(cvDocuments.userId, user.id)))
    .limit(1)

  if (!document) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  const files = await db
    .select({ storageKey: cvFiles.storageKey })
    .from(cvFiles)
    .where(and(eq(cvFiles.documentId, id), eq(cvFiles.userId, user.id)))

  await db
    .delete(cvDocuments)
    .where(and(eq(cvDocuments.id, id), eq(cvDocuments.userId, user.id)))

  await removeStoredCvFiles(event, files.map((file) => file.storageKey))

  return { ok: true }
})
