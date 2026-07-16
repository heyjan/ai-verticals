import { openOwnedCvFile, requireCvBuilderUser } from '../../../utils/cv-builder'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid file id' })
  }

  const { file, stream } = await openOwnedCvFile(event, user.id, id)
  setHeader(event, 'Content-Type', file.contentType)
  setHeader(event, 'Content-Length', String(file.sizeBytes))
  const disposition = file.contentType.startsWith('image/') ? 'inline' : 'attachment'
  setHeader(event, 'Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.originalName)}"`)
  return sendStream(event, stream)
})
