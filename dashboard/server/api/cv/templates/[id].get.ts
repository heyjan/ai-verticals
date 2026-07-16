import { requireCvBuilderUser } from '../../../utils/cv-builder'
import { resolveCvTemplate } from '../../../utils/cv-editor'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid template id' })
  }

  const template = await resolveCvTemplate(user.id, id)
  if (!template) {
    throw createError({ statusCode: 404, statusMessage: 'Template not found' })
  }

  return { template }
})
