import { cvDocuments } from '@ai-job-classifier/db'
import { desc, eq } from 'drizzle-orm'

import { createDocumentFromTemplate, getCvTemplate, requireCvBuilderUser } from '../../../utils/cv-builder'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)

  const rows = await db
    .select({
      id: cvDocuments.id,
      title: cvDocuments.title,
      templateId: cvDocuments.templateId,
      updatedAt: cvDocuments.updatedAt,
      createdAt: cvDocuments.createdAt,
    })
    .from(cvDocuments)
    .where(eq(cvDocuments.userId, user.id))
    .orderBy(desc(cvDocuments.updatedAt))

  if (rows.length) return { documents: rows }

  const template = getCvTemplate('tmpl_classic_single_col')
  if (!template) return { documents: [] }

  const seed = createDocumentFromTemplate(template, 'My CV')
  const [created] = await db
    .insert(cvDocuments)
    .values({ userId: user.id, ...seed })
    .returning({
      id: cvDocuments.id,
      title: cvDocuments.title,
      templateId: cvDocuments.templateId,
      updatedAt: cvDocuments.updatedAt,
      createdAt: cvDocuments.createdAt,
    })

  return { documents: [created!] }
})
