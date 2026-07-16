import { cvDocuments } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'

import {
  inlineOwnedCvImages,
  mergeCvTheme,
  renderCvDocx,
  renderCvHtml,
  renderCvPdf,
  requireCvBuilderUser,
  storeCvFile,
  validateCvExportData,
  type CvFormat,
} from '../../../../utils/cv-builder'
import { materializeCvDocumentContent, resolveCvTemplate } from '../../../../utils/cv-editor'
import { db } from '../../../../utils/db'

const contentTypes: Record<CvFormat, string> = {
  html: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid document id' })
  }

  const body = await readBody<{ format?: CvFormat; docxHeaderFromFirstTable?: boolean }>(event)
  const format = body.format || 'pdf'
  if (!['html', 'pdf', 'docx'].includes(format)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported export format' })
  }

  const [document] = await db
    .select()
    .from(cvDocuments)
    .where(and(eq(cvDocuments.id, id), eq(cvDocuments.userId, user.id)))
    .limit(1)

  if (!document) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found' })
  }

  const template = await resolveCvTemplate(user.id, document.templateId)
  if (!template) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown template' })
  }

  const theme = mergeCvTheme(template.theme, document.themeOverrides)
  // Slot-composed documents reference library blocks; re-materialize so block
  // edits made after the last save still reach the export.
  const content = document.slotAssignments
    ? await materializeCvDocumentContent(user.id, document.templateId, document.slotAssignments) ?? document.content
    : document.content
  const renderContent = await inlineOwnedCvImages(event, user.id, content)

  const html = renderCvHtml({
    title: document.title,
    templateId: document.templateId,
    layout: template.layout,
    content: renderContent,
    page: document.page,
    theme,
  })

  const data = format === 'html'
    ? Buffer.from(html)
    : format === 'pdf'
      ? await renderCvPdf(html, document.page)
      : await renderCvDocx({
          title: document.title,
          templateId: document.templateId,
          layout: template.layout,
          content: renderContent,
          page: document.page,
          theme,
          useFirstTableAsHeader: body.docxHeaderFromFirstTable === true,
        })
  validateCvExportData(format, data)

  const file = await storeCvFile(event, {
    userId: user.id,
    documentId: document.id,
    kind: 'export',
    format,
    originalName: `${document.title}.${format}`,
    contentType: contentTypes[format],
    data,
  })

  return { fileId: file.id, url: `/api/cv/files/${file.id}`, contentType: file.contentType }
})
