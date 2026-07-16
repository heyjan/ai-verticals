import { cvDocuments } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import { requireCvBuilderUser, storeCvFile } from '../../utils/cv-builder'
import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const parts = await readMultipartFormData(event)
  const files = (parts ?? []).filter((part) => part.filename && part.data)
  const documentIdValue = (parts ?? []).find((part) => part.name === 'documentId')?.data?.toString()
  const documentId = documentIdValue ? Number(documentIdValue) : null
  if (!files.length) {
    throw createError({ statusCode: 400, statusMessage: 'No files uploaded' })
  }

  if (documentId !== null) {
    if (!Number.isInteger(documentId)) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid document id' })
    }
    const [document] = await db
      .select({ id: cvDocuments.id })
      .from(cvDocuments)
      .where(and(eq(cvDocuments.id, documentId), eq(cvDocuments.userId, user.id)))
      .limit(1)
    if (!document) {
      throw createError({ statusCode: 404, statusMessage: 'Document not found' })
    }
  }

  const stored = []
  for (const file of files) {
    if (file.type?.startsWith('image/') && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      throw createError({ statusCode: 400, statusMessage: 'Unsupported image type' })
    }
    stored.push(await storeCvFile(event, {
      userId: user.id,
      documentId,
      kind: 'upload',
      originalName: file.filename!,
      contentType: file.type || 'application/octet-stream',
      data: file.data,
    }))
  }

  return {
    files: stored.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      sizeBytes: file.sizeBytes,
      contentType: file.contentType,
      url: `/api/cv/files/${file.id}`,
    })),
  }
})
