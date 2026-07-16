import {
  cvDocuments,
  cvTemplates as cvTemplateRows,
  cvTextBlocks,
  type CvDocumentContent,
  type CvPageSettings,
  type CvSlotAssignments,
  type CvTextBlock,
} from '@ai-job-classifier/db'
import { and, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import {
  cvTemplates as builtinCvTemplates,
  mergeCvTheme,
  sanitizeCvPageSettings,
  type CvTheme,
} from './cv-builder'
import { db } from './db'

export type CvTemplateLayout = 'one-column' | 'compact-three-column'

// Unified view over built-in (code-defined) and custom (DB-backed) templates.
export interface ResolvedCvTemplate {
  id: string
  name: string
  layout: CvTemplateLayout
  theme: CvTheme
  page: CvPageSettings
  skeleton: CvDocumentContent
  source: 'builtin' | 'custom'
}

export const CV_TAG_LIMIT = 20
export const CV_TAG_MAX_LENGTH = 40

export function newCvTemplateId() {
  return `tmpl_user_${randomUUID()}`
}

export function isBuiltinCvTemplateId(id: string) {
  return builtinCvTemplates.some((template) => template.id === id)
}

export function sanitizeCvTemplateLayout(value: unknown): CvTemplateLayout {
  return value === 'compact-three-column' ? 'compact-three-column' : 'one-column'
}

// Custom templates store their theme as a plain jsonb patch; rebuild a full
// CvTheme by merging over the built-in base that matches the layout.
export function baseCvThemeForLayout(layout: CvTemplateLayout): CvTheme {
  const base = builtinCvTemplates.find((template) => template.layout === layout) ?? builtinCvTemplates[0]!
  return structuredClone(base.theme)
}

export async function resolveCvTemplate(userId: number, id: string): Promise<ResolvedCvTemplate | null> {
  const builtin = builtinCvTemplates.find((template) => template.id === id)
  if (builtin) {
    return {
      id: builtin.id,
      name: builtin.name,
      layout: builtin.layout,
      theme: structuredClone(builtin.theme),
      page: structuredClone(builtin.page),
      skeleton: structuredClone(builtin.seed),
      source: 'builtin',
    }
  }

  const [row] = await db
    .select()
    .from(cvTemplateRows)
    .where(and(eq(cvTemplateRows.id, id), eq(cvTemplateRows.userId, userId)))
    .limit(1)

  if (!row) return null

  const layout = sanitizeCvTemplateLayout(row.layout)
  return {
    id: row.id,
    name: row.name,
    layout,
    theme: mergeCvTheme(baseCvThemeForLayout(layout), row.theme),
    page: sanitizeCvPageSettings(row.page),
    skeleton: row.skeleton,
    source: 'custom',
  }
}

export async function listCvTemplates(userId: number): Promise<ResolvedCvTemplate[]> {
  const rows = await db
    .select()
    .from(cvTemplateRows)
    .where(eq(cvTemplateRows.userId, userId))
    .orderBy(cvTemplateRows.createdAt)

  const custom = rows.map((row) => {
    const layout = sanitizeCvTemplateLayout(row.layout)
    return {
      id: row.id,
      name: row.name,
      layout,
      theme: mergeCvTheme(baseCvThemeForLayout(layout), row.theme),
      page: sanitizeCvPageSettings(row.page),
      skeleton: row.skeleton,
      source: 'custom' as const,
    }
  })

  const builtins = builtinCvTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    layout: template.layout,
    theme: structuredClone(template.theme),
    page: structuredClone(template.page),
    skeleton: structuredClone(template.seed),
    source: 'builtin' as const,
  }))

  return [...builtins, ...custom]
}

export function createDocumentFromResolvedTemplate(template: ResolvedCvTemplate, title?: string) {
  return {
    templateId: template.id,
    title: title?.trim() || 'Untitled CV',
    content: structuredClone(template.skeleton),
    themeOverrides: {},
    page: structuredClone(template.page),
  }
}

export async function countDocumentsUsingTemplate(userId: number, templateId: string) {
  const rows = await db
    .select({ id: cvDocuments.id })
    .from(cvDocuments)
    .where(and(eq(cvDocuments.userId, userId), eq(cvDocuments.templateId, templateId)))

  return rows.length
}

export function isCvDocContent(value: unknown): value is CvDocumentContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const doc = value as { type?: unknown; content?: unknown }
  return doc.type === 'doc' && (doc.content === undefined || Array.isArray(doc.content))
}

// Trim, collapse whitespace, dedupe case-insensitively, cap count and length.
// Original casing is kept for display; matching happens case-insensitively.
export function sanitizeCvTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const tags: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim().replace(/\s+/g, ' ').slice(0, CV_TAG_MAX_LENGTH)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= CV_TAG_LIMIT) break
  }
  return tags
}

export function sanitizeCvTextBlockKind(value: unknown) {
  return value === 'intro' || value === 'bullet' || value === 'heading' ? value : 'paragraph' as const
}

// Fill a template skeleton with the assigned text blocks: every textBlockSlot
// node is replaced by the ordered block contents ('bullets' slots wrap them in
// one bulletList, one listItem per block). Unfilled slots disappear, so the
// materialized doc is what preview and every exporter consume.
export async function materializeCvDocumentContent(
  userId: number,
  templateId: string,
  assignments: CvSlotAssignments,
): Promise<CvDocumentContent | null> {
  const template = await resolveCvTemplate(userId, templateId)
  if (!template) return null

  const blockIds = [...new Set(
    Object.values(assignments).flat().map((entry) => entry.blockId),
  )]
  const blocks = blockIds.length
    ? await db
        .select()
        .from(cvTextBlocks)
        .where(and(eq(cvTextBlocks.userId, userId), inArray(cvTextBlocks.id, blockIds)))
    : []
  const blocksById = new Map<number, CvTextBlock>(blocks.map((block) => [block.id, block]))

  return {
    type: 'doc',
    content: materializeNodes(structuredClone(template.skeleton).content ?? [], assignments, blocksById),
  }
}

function materializeNodes(
  nodes: unknown[],
  assignments: CvSlotAssignments,
  blocksById: Map<number, CvTextBlock>,
): unknown[] {
  return nodes.flatMap((node: any) => {
    if (!node || typeof node !== 'object') return []

    if (node.type === 'textBlockSlot') {
      const slotName = typeof node.attrs?.name === 'string' ? node.attrs.name : ''
      const entries = assignments[slotName] ?? []
      const blockContents = entries.flatMap((entry) => {
        const doc = entry.contentOverride ?? blocksById.get(entry.blockId)?.content
        const content = doc?.content
        return Array.isArray(content) && content.length ? [content] : []
      })

      if (!blockContents.length) return []
      if (node.attrs?.kind === 'bullets') {
        return [{
          type: 'bulletList',
          content: blockContents.map((content) => ({ type: 'listItem', content })),
        }]
      }
      return blockContents.flat()
    }

    if (Array.isArray(node.content)) {
      return [{ ...node, content: materializeNodes(node.content, assignments, blocksById) }]
    }
    return [node]
  })
}

export function sanitizeCvSlotAssignments(value: unknown): CvSlotAssignments | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const assignments: CvSlotAssignments = {}
  for (const [slot, entries] of Object.entries(value)) {
    const name = slot.trim().slice(0, 80)
    if (!name || !Array.isArray(entries)) continue

    assignments[name] = entries.flatMap((entry: any) => {
      const blockId = Number(entry?.blockId)
      if (!Number.isInteger(blockId) || blockId <= 0) return []
      return [{
        blockId,
        ...(isCvDocContent(entry?.contentOverride) ? { contentOverride: entry.contentOverride } : {}),
      }]
    })
  }
  return assignments
}
