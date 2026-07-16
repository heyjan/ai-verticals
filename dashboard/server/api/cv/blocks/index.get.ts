import { cvTextBlocks } from '@ai-job-classifier/db'
import { and, arrayOverlaps, desc, eq, ilike, sql, type SQL } from 'drizzle-orm'

import { requireCvBuilderUser } from '../../../utils/cv-builder'
import { sanitizeCvTags } from '../../../utils/cv-editor'
import { db } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const user = await requireCvBuilderUser(event)
  const query = getQuery(event)

  const conditions: SQL[] = [eq(cvTextBlocks.userId, user.id)]

  const search = typeof query.q === 'string' ? query.q.trim() : ''
  if (search) {
    conditions.push(ilike(cvTextBlocks.label, `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`))
  }

  // Tag matching is case-insensitive: compare lowercased block tags against
  // lowercased filter tags via array overlap.
  const tags = sanitizeCvTags(typeof query.tags === 'string' ? query.tags.split(',') : query.tags)
    .map((tag) => tag.toLowerCase())
  if (tags.length) {
    conditions.push(arrayOverlaps(
      sql`(select array_agg(lower(tag)) from unnest(${cvTextBlocks.tags}) as tag)`,
      tags,
    ))
  }

  const blocks = await db
    .select()
    .from(cvTextBlocks)
    .where(and(...conditions))
    .orderBy(desc(cvTextBlocks.updatedAt))

  return { blocks }
})
