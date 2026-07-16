import { cvFontOptions, requireCvBuilderUser } from '../../../utils/cv-builder'
import { listCvTemplates } from '../../../utils/cv-editor'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const templates = await listCvTemplates(user.id)

  return {
    fontOptions: cvFontOptions,
    templates: templates.map(({ skeleton: _skeleton, ...template }) => template),
  }
})
