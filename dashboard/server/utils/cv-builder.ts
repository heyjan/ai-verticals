import { cvFiles, users, type CvDocumentContent, type CvPageSettings } from '@ai-job-classifier/db'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'

import { db } from './db'

export type CvFormat = 'html' | 'pdf' | 'docx'

export interface CvTheme {
  fonts: { heading: string; body: string; mono: string }
  sizePt: { name: number; sectionHeading: number; body: number; small: number }
  color: { text: string; accent: string; muted: string }
  spacingPt: { paragraph: number; section: number }
  rules: { sectionUnderline: boolean; bulletChar: string }
}

export interface CvTemplate {
  id: string
  name: string
  layout: 'one-column' | 'compact-three-column'
  theme: CvTheme
  page: CvPageSettings
  seed: CvDocumentContent
  allowedBlocks: string[]
}

interface CvExportStyleProfile {
  compact: boolean
  bodyLineHeight: number
  bodyLetterSpacingTwip: number
  heading1: {
    color: string
    fontSizePt: number
    bold: boolean
    letterSpacingTwip: number
    beforePt: number
    afterPt: number
  }
  heading2: {
    color: string
    fontSizePt: number
    bold: boolean
    letterSpacingTwip: number
    beforePt: number
    afterPt: number
    underline: boolean
  }
}

export const cvFontOptions = ['Montserrat', 'Noto Sans', 'Lato'] as const

const cvFontPackages: Record<typeof cvFontOptions[number], {
  packageName: string
  filePrefix: string
}> = {
  Montserrat: { packageName: '@fontsource/montserrat', filePrefix: 'montserrat' },
  'Noto Sans': { packageName: '@fontsource/noto-sans', filePrefix: 'noto-sans' },
  Lato: { packageName: '@fontsource/lato', filePrefix: 'lato' },
}
const cvFontDataCache = new Map<string, string>()

const classicTemplate: CvTemplate = {
  id: 'tmpl_classic_single_col',
  name: 'Classic Single Column',
  layout: 'one-column',
  theme: {
    fonts: { heading: 'IBM Plex Sans', body: 'IBM Plex Sans', mono: 'IBM Plex Mono' },
    sizePt: { name: 24, sectionHeading: 12, body: 10.5, small: 9 },
    color: { text: '#1a1a2e', accent: '#e63946', muted: '#6b6b85' },
    spacingPt: { paragraph: 6, section: 14 },
    rules: { sectionUnderline: true, bulletChar: '-' },
  },
  page: { size: 'A4', margin: { top: 20, right: 18, bottom: 20, left: 18 } },
  seed: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Jane Doe' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Product Designer | jane@example.com | Berlin' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Experience' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Lead product discovery, design systems, and measurable user workflow improvements.' }],
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Skills' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Research, prototyping, analytics, stakeholder facilitation' }] },
    ],
  },
  allowedBlocks: ['heading', 'paragraph', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'image'],
}

const compactExecutiveTemplate: CvTemplate = {
  id: 'tmpl_compact_executive_grid',
  name: 'Compact Executive Grid',
  layout: 'compact-three-column',
  theme: {
    fonts: { heading: 'Segoe UI', body: 'Segoe UI', mono: 'Segoe UI' },
    sizePt: { name: 18, sectionHeading: 11, body: 10.5, small: 9.5 },
    color: { text: '#000000', accent: '#000000', muted: '#444444' },
    spacingPt: { paragraph: 3, section: 11 },
    rules: { sectionUnderline: true, bulletChar: '-' },
  },
  page: { size: 'A4', margin: { top: 12.5, right: 10, bottom: 12.5, left: 18.5 } },
  seed: {
    type: 'doc',
    content: [
      table([
        row([
          cell([paragraph('Ulm, Deutschland'), paragraph('email@example.com')]),
          cell([heading(1, 'VORNAME NACHNAME'), paragraph('AI / FULL STACK DEVELOPER')]),
          cell([paragraph('linkedin.com/in/profile'), paragraph('github.com/profile')]),
        ]),
      ]),
      heading(2, 'BERUFSERFAHRUNG'),
      table([
        row([
          cell([paragraph('AI Developer / AI Stratege')]),
          cell([
            paragraph('Unternehmen GmbH'),
            bulletList([
              'Konzeption und Umsetzung von KI-Lösungen im Enterprise-Umfeld.',
              'Brücke zwischen Fachbereichen, Management und technischer Implementierung.',
            ]),
          ]),
          cell([paragraph('2024 - heute')]),
        ]),
        row([
          cell([paragraph('Freelance Consultant')]),
          cell([
            paragraph('Selbstständig'),
            bulletList([
              'Entwicklung datengetriebener Anwendungen und Automatisierungen.',
              'Beratung zu GenAI, Analytics-Plattformen und sicheren Workflows.',
            ]),
          ]),
          cell([paragraph('2016 - 2024')]),
        ]),
      ]),
      heading(2, 'TECHNISCHE SKILLS'),
      table([
        row([
          cell([paragraph('AI & Data')]),
          cell([paragraph('Azure AI, Copilot Studio, OpenAI APIs, RAG, Analytics')]),
          cell([paragraph('Advanced')]),
        ]),
        row([
          cell([paragraph('Engineering')]),
          cell([paragraph('TypeScript, Python, SQL, APIs, Cloud Deployments')]),
          cell([paragraph('Advanced')]),
        ]),
        row([
          cell([paragraph('Governance')]),
          cell([paragraph('EU AI Act Awareness, DSGVO / Data Privacy, Enterprise IT')]),
          cell([paragraph('Strong')]),
        ]),
      ]),
      heading(2, 'PROFIL'),
      paragraph('AI-orientierter Entwickler und Stratege mit Schwerpunkt auf pragmatischen, sicheren und messbaren KI-Lösungen. Spezialisiert auf Roadmaps, Implementierung unternehmensweiter Analytics-Plattformen und den sicheren Einsatz generativer KI unter Konzern-Richtlinien.'),
    ],
  },
  allowedBlocks: ['heading', 'paragraph', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'image', 'table', 'tableRow', 'tableCell', 'tableHeader'],
}

export const cvTemplates: CvTemplate[] = [classicTemplate, compactExecutiveTemplate]

export function getCvTemplate(id: string) {
  return cvTemplates.find((template) => template.id === id)
}

export async function requireCvBuilderUser(event: any) {
  const session = await getUserSession(event)
  const sessionUser = session.user
  if (!sessionUser?.id) {
    throw createError({ statusCode: 401, statusMessage: 'Login required' })
  }

  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1)

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Login required' })
  }

  const config = useRuntimeConfig(event)
  const adminOnly = config.cvBuilder.adminOnly !== false && config.cvBuilder.adminOnly !== 'false'
  if (adminOnly && user.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'CV builder is restricted to admins' })
  }

  return user
}

export function createDocumentFromTemplate(template: CvTemplate, title?: string) {
  return {
    templateId: template.id,
    title: title?.trim() || 'Untitled CV',
    content: structuredClone(template.seed),
    themeOverrides: {},
    page: template.page,
  }
}

export function sanitizeCvPageSettings(page: CvPageSettings): CvPageSettings {
  const margin = page.margin || { top: 12, right: 12, bottom: 12, left: 12 }
  return {
    size: page.size === 'Letter' ? 'Letter' : 'A4',
    margin: {
      top: clampMargin(margin.top),
      right: clampMargin(margin.right),
      bottom: clampMargin(margin.bottom),
      left: clampMargin(margin.left),
    },
  }
}

export function mergeCvTheme(base: CvTheme, overrides: Record<string, unknown> | null | undefined): CvTheme {
  const theme = structuredClone(base)
  const patch = overrides && typeof overrides === 'object' ? overrides as Record<string, any> : {}

  for (const key of ['heading', 'body', 'mono'] as const) {
    const value = patch.fonts?.[key]
    if (isCvGoogleFont(value)) theme.fonts[key] = value
  }

  for (const key of ['name', 'sectionHeading', 'body', 'small'] as const) {
    const value = Number(patch.sizePt?.[key])
    if (Number.isFinite(value) && value >= 6 && value <= 48) theme.sizePt[key] = value
  }

  for (const key of ['text', 'accent', 'muted'] as const) {
    const value = patch.color?.[key]
    if (typeof value === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) theme.color[key] = value
  }

  for (const key of ['paragraph', 'section'] as const) {
    const value = Number(patch.spacingPt?.[key])
    if (Number.isFinite(value) && value >= 0 && value <= 48) theme.spacingPt[key] = value
  }

  if (typeof patch.rules?.sectionUnderline === 'boolean') {
    theme.rules.sectionUnderline = patch.rules.sectionUnderline
  }

  return theme
}

export function renderCvHtml(params: {
  title: string
  templateId?: string
  layout?: string
  content: CvDocumentContent
  page: CvPageSettings
  theme: CvTheme
}) {
  const { title, content, page, theme } = params
  const body = renderNodes(content.content ?? [])
  const layoutClass = isCompactCvLayout(params.templateId, params.layout) ? 'layout-compact-grid' : 'layout-classic'
  const profile = cvExportStyleProfile(theme, params.templateId, params.layout)
  const fontFaces = renderLocalCvFontFaces(theme)
  const css = `
    @page { size: ${page.size}; margin: ${page.margin.top}mm ${page.margin.right}mm ${page.margin.bottom}mm ${page.margin.left}mm; }
    :root {
      --cv-font-heading: ${theme.fonts.heading};
      --cv-font-body: ${theme.fonts.body};
      --cv-color-text: ${theme.color.text};
      --cv-color-accent: ${theme.color.accent};
      --cv-color-muted: ${theme.color.muted};
    }
    body { margin: 0; color: var(--cv-color-text); font-family: var(--cv-font-body), sans-serif; font-size: ${theme.sizePt.body}pt; line-height: ${profile.bodyLineHeight}; }
    main { max-width: 186mm; margin: 0 auto; }
    h1, h2, h3 { font-family: var(--cv-font-heading), sans-serif; margin: 0; line-height: 1.15; }
    h1 { color: #${profile.heading1.color}; font-size: ${profile.heading1.fontSizePt}pt; font-weight: ${profile.heading1.bold ? 700 : 400}; letter-spacing: ${profile.heading1.letterSpacingTwip / 20}pt; margin: ${profile.heading1.beforePt}pt 0 ${profile.heading1.afterPt}pt; }
    h2 { color: #${profile.heading2.color}; font-size: ${profile.heading2.fontSizePt}pt; font-weight: ${profile.heading2.bold ? 700 : 400}; letter-spacing: ${profile.heading2.letterSpacingTwip / 20}pt; margin: ${profile.heading2.beforePt}pt 0 ${profile.heading2.afterPt}pt; padding-bottom: ${profile.heading2.underline ? 4 : 0}pt; ${profile.heading2.underline ? `border-bottom: 1px solid #${profile.heading2.color};` : ''} }
    p { margin: ${theme.spacingPt.paragraph}pt 0; white-space: pre-wrap; }
    ul, ol { margin: ${theme.spacingPt.paragraph}pt 0 ${theme.spacingPt.paragraph}pt 18pt; padding-left: 12pt; }
    ul { list-style-type: disc; }
    ol { list-style-type: decimal; }
    ul ul { list-style-type: circle; }
    ul ul ul { list-style-type: square; }
    li { margin: 3pt 0; white-space: pre-wrap; }
    li > p { margin: 2pt 0; }
    li::marker { font-size: 1.35em; }
    hr { border: 0; border-top: 1px solid var(--cv-color-muted); margin: ${theme.spacingPt.section}pt 0; }
    a { color: var(--cv-color-accent); }
    img { display: block; max-width: 100%; height: auto; margin: ${theme.spacingPt.paragraph}pt 0; }
    img[data-align="center"] { margin-left: auto; margin-right: auto; }
    img[data-align="right"] { margin-left: auto; margin-right: 0; }
    img[data-align="left"] { margin-left: 0; margin-right: auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: ${theme.spacingPt.paragraph}pt 0 ${theme.spacingPt.section}pt; }
    td, th { vertical-align: top; padding: 4pt 7pt 4pt 0; border: 0; }
    th { text-align: left; }
    .layout-compact-grid { letter-spacing: .02em; }
    .layout-compact-grid main { max-width: none; }
    .layout-compact-grid h1 { text-align: center; padding-bottom: 0; }
    .layout-compact-grid h2 { padding-bottom: 3pt; }
    .layout-compact-grid p { margin: 2pt 0; }
    .layout-compact-grid ul { margin: 3pt 0 3pt 12pt; padding-left: 9pt; }
    .layout-compact-grid td:first-child { width: 34%; }
    .layout-compact-grid td:nth-child(2) { width: 44%; }
    .layout-compact-grid td:nth-child(3) { width: 22%; text-align: right; }
    .layout-compact-grid table:first-child td { vertical-align: middle; font-size: 9.5pt; }
    .layout-compact-grid table:first-child td:nth-child(2) { text-align: center; }
    @media screen { body { background: #f4f3f0; } main { background: white; min-height: 257mm; padding: ${page.margin.top}mm ${page.margin.right}mm ${page.margin.bottom}mm ${page.margin.left}mm; box-shadow: 0 20px 60px rgba(26,26,46,.12); } }
  `

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${fontFaces}${css}</style></head><body class="${layoutClass}"><main>${body}</main></body></html>`
}

export async function renderCvDocx(params: {
  title: string
  templateId?: string
  layout?: string
  content: CvDocumentContent
  page: CvPageSettings
  theme: CvTheme
  useFirstTableAsHeader?: boolean
}) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, TableLayoutType, TableBorders, Header, AlignmentType, ImageRun, ExternalHyperlink, BorderStyle, VerticalAlignTable } = await import('docx')
  const docx = {
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    TableLayoutType,
    TableBorders,
    AlignmentType,
    ImageRun,
    ExternalHyperlink,
    BorderStyle,
    VerticalAlignTable,
  }
  const profile = cvExportStyleProfile(params.theme, params.templateId, params.layout)
  const nodes = params.content.content ?? []
  const firstNode = nodes[0] as any
  const useHeader = params.useFirstTableAsHeader === true && firstNode?.type === 'table'
  const context = {
    tableWidthTwip: docxContentWidthTwip(params.page),
    theme: params.theme,
    profile,
  }
  const headerChildren = useHeader ? await toDocxParagraphs([firstNode], docx, context) : []
  const bodyNodes = useHeader ? nodes.slice(1) : nodes
  const children = await toDocxParagraphs(bodyNodes, docx, context)
  const sectionChildren = children.length ? children : [new Paragraph({ text: '' })]

  const doc = new Document({
    creator: 'AI Job Command Center',
    title: params.title,
    styles: {
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: {
            font: params.theme.fonts.body,
            size: halfPoints(params.theme.sizePt.body),
            color: docxColor(params.theme.color.text),
            characterSpacing: profile.bodyLetterSpacingTwip,
          },
          paragraph: {
            spacing: {
              after: pointsToTwip(params.theme.spacingPt.paragraph),
              line: Math.round(240 * profile.bodyLineHeight),
            },
          },
        },
        {
          id: 'CvHeading1',
          name: 'CV Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: params.theme.fonts.heading,
            size: halfPoints(profile.heading1.fontSizePt),
            color: profile.heading1.color,
            bold: profile.heading1.bold,
            characterSpacing: profile.heading1.letterSpacingTwip,
          },
          paragraph: {
            keepNext: true,
            outlineLevel: 0,
            spacing: {
              before: pointsToTwip(profile.heading1.beforePt),
              after: pointsToTwip(profile.heading1.afterPt),
              line: Math.round(240 * 1.15),
            },
          },
        },
        {
          id: 'CvHeading2',
          name: 'CV Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: params.theme.fonts.heading,
            size: halfPoints(profile.heading2.fontSizePt),
            color: profile.heading2.color,
            bold: profile.heading2.bold,
            characterSpacing: profile.heading2.letterSpacingTwip,
          },
          paragraph: {
            keepNext: true,
            outlineLevel: 1,
            border: profile.heading2.underline
              ? {
                  bottom: {
                    color: profile.heading2.color,
                    size: 6,
                    space: profile.compact ? 3 : 4,
                    style: BorderStyle.SINGLE,
                  },
                }
              : undefined,
            spacing: {
              before: pointsToTwip(profile.heading2.beforePt),
              after: pointsToTwip(profile.heading2.afterPt),
              line: Math.round(240 * 1.15),
            },
          },
        },
      ],
    },
    sections: [
      {
        headers: useHeader
          ? {
              default: new Header({ children: headerChildren }),
              first: new Header({ children: headerChildren }),
            }
          : undefined,
        properties: {
          page: {
            size: docxPageSize(params.page),
            margin: {
              top: mmToTwip(params.page.margin.top),
              right: mmToTwip(params.page.margin.right),
              bottom: mmToTwip(params.page.margin.bottom),
              left: mmToTwip(params.page.margin.left),
            },
          },
        },
        children: sectionChildren,
      },
    ],
  })

  const data = await normalizeDocxImageMetadata(await Packer.toBuffer(doc))
  validateCvExportData('docx', data)
  return data
}

async function normalizeDocxImageMetadata(data: Buffer) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(data)
  const xmlNames = Object.keys(zip.files)
    .filter((name) => /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(name))

  let drawingId = 1
  let changed = false

  for (const name of xmlNames) {
    const file = zip.file(name)
    if (!file) continue

    let xml = await file.async('string')
    xml = xml.replace(/<wp:docPr\b([^>]*)\/>/g, (_match, attrs: string) => {
      const label = xmlAttr(attrs, 'name')?.trim() || `Picture ${drawingId}`
      let nextAttrs = setXmlAttr(attrs, 'id', String(drawingId))
      nextAttrs = setXmlAttr(nextAttrs, 'name', label)
      drawingId += 1
      changed = true
      return `<wp:docPr${nextAttrs}/>`
    })
    xml = xml.replace(/<pic:cNvPr\b([^>]*)\/>/g, (_match, attrs: string) => {
      const label = xmlAttr(attrs, 'name')?.trim() || `Picture ${drawingId}`
      let nextAttrs = setXmlAttr(attrs, 'id', String(drawingId))
      nextAttrs = setXmlAttr(nextAttrs, 'name', label)
      if (!xmlAttr(nextAttrs, 'descr')) nextAttrs = setXmlAttr(nextAttrs, 'descr', '')
      drawingId += 1
      changed = true
      return `<pic:cNvPr${nextAttrs}/>`
    })

    zip.file(name, xml)
  }

  if (!changed) return data

  return Buffer.from(await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  }))
}

function xmlAttr(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`\\s${name}="([^"]*)"`))
  return match?.[1]
}

function setXmlAttr(attrs: string, name: string, value: string) {
  const escaped = escapeXmlAttr(value)
  const pattern = new RegExp(`\\s${name}="[^"]*"`)
  if (pattern.test(attrs)) return attrs.replace(pattern, ` ${name}="${escaped}"`)
  return `${attrs} ${name}="${escaped}"`
}

function escapeXmlAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function renderCvPdf(html: string, pageSettings: CvPageSettings) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    await page.emulateMedia({ media: 'print' })
    await page.setContent(html, { waitUntil: 'load', timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    return await page.pdf({
      format: pageSettings.size,
      printBackground: true,
      margin: {
        top: `${pageSettings.margin.top}mm`,
        right: `${pageSettings.margin.right}mm`,
        bottom: `${pageSettings.margin.bottom}mm`,
        left: `${pageSettings.margin.left}mm`,
      },
    })
  } finally {
    await browser.close()
  }
}

export function validateCvExportData(format: CvFormat, data: Buffer | Uint8Array) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (format === 'pdf') {
    if (buffer.byteLength < 1024 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw createError({ statusCode: 500, statusMessage: 'PDF export generated an invalid file' })
    }
    return
  }

  if (format === 'docx') {
    if (
      buffer.byteLength < 4096
      || !buffer.subarray(0, 2).equals(Buffer.from('PK'))
      || !buffer.includes(Buffer.from('[Content_Types].xml'))
      || !buffer.includes(Buffer.from('word/document.xml'))
    ) {
      throw createError({ statusCode: 500, statusMessage: 'DOCX export generated an invalid file' })
    }
    return
  }

  if (buffer.byteLength < 64 || !buffer.includes(Buffer.from('<!doctype html>'))) {
    throw createError({ statusCode: 500, statusMessage: 'HTML export generated an invalid file' })
  }
}

export async function storeCvFile(event: any, params: {
  userId: number
  documentId?: number | null
  kind: 'export' | 'upload'
  format?: CvFormat | null
  originalName: string
  contentType: string
  data: Buffer | Uint8Array
}) {
  const extension = extensionFor(params.originalName, params.format)
  const fileName = `${Date.now()}-${randomUUID()}${extension}`
  const storageKey = `users/${params.userId}/${params.kind}s/${fileName}`
  const path = resolveStoragePath(event, storageKey)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, params.data)

  const [file] = await db
    .insert(cvFiles)
    .values({
      userId: params.userId,
      documentId: params.documentId ?? null,
      kind: params.kind,
      format: params.format ?? null,
      originalName: basename(params.originalName),
      storageKey,
      contentType: params.contentType,
      sizeBytes: params.data.byteLength,
    })
    .returning()

  return file!
}

export async function openOwnedCvFile(event: any, userId: number, fileId: number) {
  const [file] = await db
    .select()
    .from(cvFiles)
    .where(and(eq(cvFiles.id, fileId), eq(cvFiles.userId, userId)))
    .limit(1)

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }

  const path = resolveStoragePath(event, file.storageKey)
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }

  return { file, stream: createReadStream(path) }
}

export async function inlineOwnedCvImages(event: any, userId: number, content: CvDocumentContent): Promise<CvDocumentContent> {
  const cloned = structuredClone(content)
  const imageCache = new Map<number, string | null>()

  async function visit(node: any): Promise<void> {
    if (!node || typeof node !== 'object') return

    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      const fileId = imageFileIdFromSrc(node.attrs.src)
      if (fileId) {
        if (!imageCache.has(fileId)) {
          imageCache.set(fileId, await imageDataUrl(event, userId, fileId))
        }
        const src = imageCache.get(fileId)
        if (src) node.attrs.src = src
      }
    }

    await Promise.all((node.content ?? []).map(visit))
  }

  await visit(cloned)
  return cloned
}

export async function removeStoredCvFiles(event: any, storageKeys: string[]) {
  await Promise.all(storageKeys.map(async (key) => {
    const path = resolveStoragePath(event, key)
    await unlink(path).catch((error: any) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }))
}

function renderNodes(nodes: unknown[]): string {
  return nodes.map(renderNode).join('')
}

function renderNode(node: any): string {
  if (!node || typeof node !== 'object') return ''
  // Unfilled template slots never reach the exported document.
  if (node.type === 'textBlockSlot') return ''
  if (node.type === 'text') return renderTextNode(node)
  if (node.type === 'paragraph') return `<p${textAlignAttribute(node)}>${renderNodes(node.content ?? [])}</p>`
  if (node.type === 'heading') {
    const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 2))
    return `<h${level}${textAlignAttribute(node)}>${renderNodes(node.content ?? [])}</h${level}>`
  }
  if (node.type === 'bulletList') return `<ul>${renderNodes(node.content ?? [])}</ul>`
  if (node.type === 'orderedList') return `<ol>${renderNodes(node.content ?? [])}</ol>`
  if (node.type === 'listItem') return `<li>${renderNodes(node.content ?? [])}</li>`
  if (node.type === 'table') return renderTableNode(node)
  if (node.type === 'tableRow') return `<tr>${renderNodes(node.content ?? [])}</tr>`
  if (node.type === 'tableCell') return renderTableCellNode('td', node)
  if (node.type === 'tableHeader') return renderTableCellNode('th', node)
  if (node.type === 'image') return renderImageNode(node)
  if (node.type === 'hardBreak') return '<br>'
  if (node.type === 'horizontalRule') return '<hr>'
  return renderNodes(node.content ?? [])
}

function renderImageNode(node: any): string {
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
  if (!isSafeImageSrc(src)) return ''

  const attrs = [`src="${escapeAttribute(src)}"`]
  if (typeof node.attrs?.alt === 'string') attrs.push(`alt="${escapeAttribute(node.attrs.alt)}"`)
  if (typeof node.attrs?.title === 'string') attrs.push(`title="${escapeAttribute(node.attrs.title)}"`)

  const image = decodeImageDataUrl(src)
  const dimensions = imageDisplayDimensions(node, image ? readImageSize(image.data, image.type) : null)
  const align = isTextAlign(node.attrs?.textAlign) ? node.attrs.textAlign : null
  const grayscale = isImageGrayscale(node.attrs?.grayscale)
  if (align) attrs.push(`data-align="${align}"`)
  if (grayscale) attrs.push('data-grayscale="true"')
  const style = [
    dimensions.width ? `width: ${dimensions.width}px` : '',
    dimensions.height ? `height: ${dimensions.height}px` : '',
    align ? imageAlignmentStyle(align) : '',
    grayscale ? 'filter: grayscale(1)' : '',
  ].filter(Boolean).join('; ')
  if (style) attrs.push(`style="${escapeAttribute(style)}"`)

  return `<img ${attrs.join(' ')}>`
}

function renderTableNode(node: any): string {
  const colWidths = getTableColumnWidths(node)
  const totalWidth = colWidths.reduce((sum, width) => sum + width, 0)
  const colgroup = colWidths.length
    ? `<colgroup>${colWidths.map((width) => `<col style="width: ${((width / totalWidth) * 100).toFixed(3)}%">`).join('')}</colgroup>`
    : ''
  const attrs = isTableBorderless(node) ? ' data-borderless="true" class="cv-table-borderless"' : ''

  return `<table${attrs}>${colgroup}${renderNodes(node.content ?? [])}</table>`
}

function renderTableCellNode(tag: 'td' | 'th', node: any): string {
  const attrs: string[] = []
  const colspan = Number(node.attrs?.colspan)
  const rowspan = Number(node.attrs?.rowspan)
  const colwidth = Array.isArray(node.attrs?.colwidth) ? node.attrs.colwidth.filter((width: unknown) => Number.isFinite(Number(width))) : []

  if (Number.isFinite(colspan) && colspan > 1) attrs.push(`colspan="${colspan}"`)
  if (Number.isFinite(rowspan) && rowspan > 1) attrs.push(`rowspan="${rowspan}"`)
  if (colwidth.length) attrs.push(`colwidth="${escapeAttribute(colwidth.join(','))}"`)

  return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${renderNodes(node.content ?? [])}</${tag}>`
}

function isTableBorderless(node: any) {
  return node.attrs?.borderless === true || node.attrs?.borderless === 'true'
}

function textAlignAttribute(node: any) {
  const align = node.attrs?.textAlign
  return isTextAlign(align) ? ` style="text-align: ${align}"` : ''
}

function renderTextNode(node: any): string {
  let text = escapeHtml(String(node.text ?? ''))
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') text = `<strong>${text}</strong>`
    if (mark.type === 'italic') text = `<em>${text}</em>`
    if (mark.type === 'underline') text = `<u>${text}</u>`
    if (mark.type === 'textStyle') {
      const fontSize = normalizeFontSize(mark.attrs?.fontSize)
      if (fontSize) text = `<span style="font-size: ${escapeAttribute(fontSize)}">${text}</span>`
    }
    if (mark.type === 'link') {
      const href = safeLinkHref(mark.attrs?.href)
      if (href) text = `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    }
  }
  return text
}

function getTableColumnWidths(node: any): number[] {
  const firstRow = (node.content ?? []).find((rowNode: any) => rowNode?.type === 'tableRow')
  if (!firstRow) return []

  const widths: number[] = []
  let hasExplicitWidth = false
  let explicitTotal = 0
  let explicitCount = 0
  const missingIndexes: number[] = []

  for (const cellNode of firstRow.content ?? []) {
    const colspan = Math.max(1, Number(cellNode?.attrs?.colspan) || 1)
    const colwidth = Array.isArray(cellNode?.attrs?.colwidth) ? cellNode.attrs.colwidth : []

    for (let index = 0; index < colspan; index += 1) {
      const width = Number(colwidth[index])
      if (Number.isFinite(width) && width > 0) {
        hasExplicitWidth = true
        const roundedWidth = Math.round(width)
        explicitTotal += roundedWidth
        explicitCount += 1
        widths.push(roundedWidth)
      } else {
        missingIndexes.push(widths.length)
        widths.push(0)
      }
    }
  }

  const fallbackWidth = explicitCount > 0 ? Math.round(explicitTotal / explicitCount) : 0
  for (const index of missingIndexes) {
    widths[index] = fallbackWidth
  }

  return hasExplicitWidth ? widths : []
}

async function imageDataUrl(event: any, userId: number, fileId: number) {
  const [file] = await db
    .select()
    .from(cvFiles)
    .where(and(eq(cvFiles.id, fileId), eq(cvFiles.userId, userId)))
    .limit(1)

  if (!file?.contentType.startsWith('image/')) return null

  const path = resolveStoragePath(event, file.storageKey)
  const data = await readFile(path).catch(() => null)
  return data ? `data:${file.contentType};base64,${data.toString('base64')}` : null
}

function imageFileIdFromSrc(src: string) {
  const match = src.match(/^\/api\/cv\/files\/([0-9]+)$/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isInteger(id) ? id : null
}

function isSafeImageSrc(src: string) {
  return src.startsWith('/api/cv/files/')
    || src.startsWith('data:image/png;base64,')
    || src.startsWith('data:image/jpeg;base64,')
    || src.startsWith('data:image/webp;base64,')
    || src.startsWith('data:image/gif;base64,')
}

function imageDimension(value: unknown) {
  const dimension = Number(value)
  return Number.isFinite(dimension) ? Math.min(1200, Math.max(8, Math.round(dimension))) : null
}

function imageDisplayDimensions(node: any, intrinsic?: { width: number; height: number } | null, options?: { maxWidth?: number }) {
  const widthAttr = imageDimension(node.attrs?.width)
  const heightAttr = imageDimension(node.attrs?.height)
  const maxWidth = options?.maxWidth ?? 1200
  const width = Math.min(widthAttr ?? intrinsic?.width ?? 180, maxWidth)

  if (intrinsic?.width && intrinsic.height) {
    const ratioHeight = Math.max(8, Math.round(width * (intrinsic.height / intrinsic.width)))
    return { width, height: ratioHeight }
  }

  return { width, height: heightAttr ?? null }
}

function isImageGrayscale(value: unknown) {
  return value === true || value === 'true'
}

async function toDocxParagraphs(
  nodes: unknown[],
  docx: any,
  context: { tableWidthTwip: number; theme: CvTheme; profile: CvExportStyleProfile },
): Promise<any[]> {
  const blocks = await Promise.all(nodes.map(async (node: any) => {
    if (!node || typeof node !== 'object') return []
    if (node.type === 'textBlockSlot') return []
    if (node.type === 'heading') {
      const isHeading1 = Number(node.attrs?.level) === 1
      const style = isHeading1 ? 'CvHeading1' : 'CvHeading2'
      return [new docx.Paragraph({
        style,
        alignment: toDocxAlignment(node, docx),
        children: toDocxRuns(
          node.content ?? [],
          docx,
          context.theme,
          docxHeadingRunStyle(context, isHeading1 ? 1 : 2),
        ),
      })]
    }
    if (node.type === 'paragraph') {
      return [new docx.Paragraph({
        style: 'Normal',
        alignment: toDocxAlignment(node, docx),
        children: toDocxRuns(node.content ?? [], docx, context.theme, docxBodyRunStyle(context)),
      })]
    }
    if (node.type === 'bulletList') {
      return (node.content ?? []).map((item: any) => new docx.Paragraph({
        style: 'Normal',
        bullet: { level: 0 },
        spacing: { before: 0, after: pointsToTwip(3) },
        children: toDocxRuns(item.content ?? [], docx, context.theme, docxBodyRunStyle(context)),
      }))
    }
    if (node.type === 'orderedList') {
      return (node.content ?? []).map((item: any, index: number) => new docx.Paragraph({
        style: 'Normal',
        spacing: { before: 0, after: pointsToTwip(3) },
        children: [
          new docx.TextRun({ text: `${index + 1}. `, ...docxBodyRunStyle(context) }),
          ...toDocxRuns(item.content ?? [], docx, context.theme, docxBodyRunStyle(context)),
        ],
      }))
    }
    if (node.type === 'image') {
      const run = toDocxImageRun(node, docx)
      return run ? [new docx.Paragraph({ alignment: toDocxAlignment(node, docx), children: [run] })] : []
    }
    if (node.type === 'table') {
      const columnWidths = docxTableColumnWidths(node, context.tableWidthTwip)
      const rows = await Promise.all((node.content ?? []).map(async (tableRow: any) => {
        let columnIndex = 0
        const cells = await Promise.all((tableRow.content ?? []).map(async (tableCell: any) => {
          const colspan = docxCellSpan(tableCell.attrs?.colspan)
          const rowspan = docxCellSpan(tableCell.attrs?.rowspan)
          const cellWidth = docxCellWidth(columnWidths, columnIndex, colspan)
          columnIndex += colspan
          const children = (await toDocxParagraphs(
            tableCell.content ?? [],
            docx,
            { ...context, tableWidthTwip: cellWidth },
          )).filter((child) => child instanceof docx.Paragraph || child instanceof docx.Table)
          return new docx.TableCell({
            children: children.length ? children : [new docx.Paragraph({ text: '' })],
            width: { size: cellWidth, type: docx.WidthType.DXA },
            margins: {
              top: pointsToTwip(4),
              right: pointsToTwip(7),
              bottom: pointsToTwip(4),
              left: 0,
            },
            verticalAlign: docx.VerticalAlignTable.TOP,
            columnSpan: colspan > 1 ? colspan : undefined,
            rowSpan: rowspan > 1 ? rowspan : undefined,
          })
        }))
        return new docx.TableRow({ children: cells })
      }))
      return [new docx.Table({
        width: { size: context.tableWidthTwip, type: docx.WidthType.DXA },
        columnWidths,
        layout: docx.TableLayoutType.FIXED,
        borders: isTableBorderless(node) ? docx.TableBorders.NONE : undefined,
        rows,
      })]
    }
    if (node.type === 'horizontalRule') {
      return [new docx.Paragraph({
        style: 'Normal',
        border: {
          bottom: {
            color: docxColor(context.theme.color.muted),
            size: 6,
            space: 1,
            style: docx.BorderStyle.SINGLE,
          },
        },
        spacing: {
          before: pointsToTwip(context.theme.spacingPt.section / 2),
          after: pointsToTwip(context.theme.spacingPt.section / 2),
        },
      })]
    }
    return toDocxParagraphs(node.content ?? [], docx, context)
  }))
  return blocks.flat()
}

function toDocxRuns(
  nodes: unknown[],
  docx: any,
  theme: CvTheme,
  defaults: Record<string, unknown>,
): any[] {
  return nodes.flatMap((node: any) => {
    if (!node || typeof node !== 'object') return []
    if (node.type === 'text') {
      const marks = node.marks ?? []
      const href = safeLinkHref(marks.find((mark: any) => mark.type === 'link')?.attrs?.href)
      const run = new docx.TextRun({
        ...defaults,
        text: String(node.text ?? ''),
        bold: Boolean(defaults.bold) || marks.some((mark: any) => mark.type === 'bold'),
        italics: marks.some((mark: any) => mark.type === 'italic'),
        underline: marks.some((mark: any) => mark.type === 'underline') || href ? {} : undefined,
        color: href ? docxColor(theme.color.accent) : defaults.color,
        size: docxFontSize(marks) ?? defaults.size,
      })
      return href ? [new docx.ExternalHyperlink({ link: href, children: [run] })] : [run]
    }
    if (node.type === 'hardBreak') return [new docx.TextRun({ ...defaults, text: '\n', break: 1 })]
    return toDocxRuns(node.content ?? [], docx, theme, defaults)
  })
}

function docxBodyRunStyle(context: { theme: CvTheme; profile: CvExportStyleProfile }) {
  return {
    font: context.theme.fonts.body,
    size: halfPoints(context.theme.sizePt.body),
    color: docxColor(context.theme.color.text),
    characterSpacing: context.profile.bodyLetterSpacingTwip,
  }
}

function docxHeadingRunStyle(
  context: { theme: CvTheme; profile: CvExportStyleProfile },
  level: 1 | 2,
) {
  const heading = level === 1 ? context.profile.heading1 : context.profile.heading2
  return {
    font: context.theme.fonts.heading,
    size: halfPoints(heading.fontSizePt),
    color: heading.color,
    bold: heading.bold,
    characterSpacing: heading.letterSpacingTwip,
  }
}

function toDocxAlignment(node: any, docx: any) {
  const align = node.attrs?.textAlign
  if (align === 'center') return docx.AlignmentType.CENTER
  if (align === 'right') return docx.AlignmentType.RIGHT
  if (align === 'left') return docx.AlignmentType.LEFT
  return undefined
}

function docxFontSize(marks: any[]) {
  const textStyle = marks.find((mark: any) => mark.type === 'textStyle')
  const fontSize = normalizeFontSize(textStyle?.attrs?.fontSize)
  if (!fontSize) return undefined

  const match = fontSize.match(/^([0-9]+(?:\.[0-9]+)?)(pt|px)$/)
  if (!match) return undefined

  const value = Number(match[1])
  const points = match[2] === 'px' ? value * 0.75 : value
  return Math.round(points * 2)
}

function toDocxImageRun(node: any, docx: any) {
  const image = decodeImageDataUrl(node.attrs?.src)
  if (!image) return null

  const dimensions = imageDisplayDimensions(node, readImageSize(image.data, image.type), { maxWidth: 520 })
  const name = docxImageName(node)

  return new docx.ImageRun({
    type: image.type,
    data: image.data,
    transformation: { width: dimensions.width, height: dimensions.height ?? 120 },
    altText: {
      name,
      title: name,
      description: typeof node.attrs?.alt === 'string' ? node.attrs.alt : name,
    },
  })
}

function docxImageName(node: any) {
  const title = typeof node.attrs?.title === 'string' ? node.attrs.title.trim() : ''
  if (title) return title

  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt.trim() : ''
  if (alt) return alt

  return 'CV image'
}

function decodeImageDataUrl(value: unknown): { type: 'jpg' | 'png' | 'gif'; data: Buffer } | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^data:image\/(png|jpe?g|gif);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null

  return {
    type: match[1] === 'png' || match[1] === 'gif' ? match[1] : 'jpg',
    data: Buffer.from(match[2], 'base64'),
  }
}

function readImageSize(data: Buffer, type: 'jpg' | 'png' | 'gif') {
  if (type === 'png' && data.length >= 24) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }

  if (type === 'gif' && data.length >= 10) {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  }

  if (type === 'jpg') return readJpegSize(data)
  return null
}

function readJpegSize(data: Buffer) {
  let offset = 2
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) break
    const marker = data[offset + 1]
    const length = data.readUInt16BE(offset + 2)
    if (length < 2) break
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
    }
    offset += 2 + length
  }
  return null
}

function resolveStoragePath(event: any, key: string) {
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid storage key' })
  }
  const root = resolve(process.cwd(), String(useRuntimeConfig(event).cvBuilder.storageRoot))
  const path = resolve(root, key)
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid storage key' })
  }
  return path
}

function extensionFor(name: string, format?: CvFormat | null) {
  if (format) return `.${format}`
  const safeName = basename(name)
  const match = safeName.match(/\.[a-z0-9]{1,12}$/i)
  return match?.[0]?.toLowerCase() ?? '.bin'
}

function mmToTwip(mm: number) {
  return Math.round(mm * 56.6929)
}

function pointsToTwip(points: number) {
  return Math.round(points * 20)
}

function halfPoints(points: number) {
  return Math.round(points * 2)
}

function docxColor(color: string) {
  return color.replace(/^#/, '').toUpperCase()
}

function docxPageSize(page: CvPageSettings) {
  return page.size === 'Letter'
    ? { width: 12240, height: 15840 }
    : { width: 11906, height: 16838 }
}

function docxContentWidthTwip(page: CvPageSettings) {
  const pageWidth = page.size === 'Letter' ? 12240 : 11906
  const contentWidth = pageWidth - mmToTwip(page.margin.left) - mmToTwip(page.margin.right)
  return Math.max(1440, contentWidth)
}

function docxCellSpan(value: unknown) {
  const span = Number(value)
  return Number.isFinite(span) ? Math.max(1, Math.round(span)) : 1
}

function docxTableColumnWidths(node: any, tableWidthTwip: number) {
  const gridColumnCount = Math.max(1, ...((node.content ?? []) as any[]).map((rowNode: any) => {
    return (rowNode.content ?? []).reduce((sum: number, cellNode: any) => {
      return sum + docxCellSpan(cellNode?.attrs?.colspan)
    }, 0)
  }))
  const explicitWidths = getTableColumnWidths(node)
  const sourceWidths = explicitWidths.length === gridColumnCount
    ? explicitWidths
    : Array.from({ length: gridColumnCount }, () => 1)
  const sourceTotal = sourceWidths.reduce((sum, width) => sum + width, 0)

  if (sourceTotal <= 0) return Array.from({ length: gridColumnCount }, () => Math.floor(tableWidthTwip / gridColumnCount))

  let remaining = tableWidthTwip
  return sourceWidths.map((width, index) => {
    if (index === sourceWidths.length - 1) return Math.max(1, remaining)
    const columnWidth = Math.max(1, Math.round((width / sourceTotal) * tableWidthTwip))
    remaining -= columnWidth
    return columnWidth
  })
}

function docxCellWidth(columnWidths: number[], columnIndex: number, colspan: number) {
  const width = columnWidths
    .slice(columnIndex, columnIndex + colspan)
    .reduce((sum, columnWidth) => sum + columnWidth, 0)
  return Math.max(1, width)
}

function clampMargin(value: unknown) {
  const margin = Number(value)
  return Number.isFinite(margin) ? Math.min(50, Math.max(0, margin)) : 12
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('`', '&#96;')
}

function safeLinkHref(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
    const parsed = new URL(href)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol) ? href : null
  } catch {
    return null
  }
}

function isCvGoogleFont(value: unknown): value is typeof cvFontOptions[number] {
  return typeof value === 'string' && cvFontOptions.includes(value as typeof cvFontOptions[number])
}

function isTextAlign(value: unknown): value is 'left' | 'center' | 'right' {
  return value === 'left' || value === 'center' || value === 'right'
}

function imageAlignmentStyle(align: 'left' | 'center' | 'right') {
  if (align === 'center') return 'margin-left: auto; margin-right: auto'
  if (align === 'right') return 'margin-left: auto; margin-right: 0'
  return 'margin-left: 0; margin-right: auto'
}

function normalizeFontSize(value: unknown) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(pt|px)$/)
  if (!match) return null

  const size = Number(match[1])
  if (!Number.isFinite(size)) return null

  const points = match[2] === 'px' ? size * 0.75 : size
  if (points < 6 || points > 48) return null

  return `${match[1]}${match[2]}`
}

function isCompactCvLayout(templateId?: string, layout?: string) {
  return layout === 'compact-three-column' || templateId === 'tmpl_compact_executive_grid'
}

function cvExportStyleProfile(theme: CvTheme, templateId?: string, layout?: string): CvExportStyleProfile {
  const compact = isCompactCvLayout(templateId, layout)
  return {
    compact,
    bodyLineHeight: compact ? 1.32 : 1.45,
    bodyLetterSpacingTwip: compact ? 4 : 0,
    heading1: {
      color: docxColor(theme.color.text),
      fontSizePt: compact ? 18 : theme.sizePt.name,
      bold: !compact,
      letterSpacingTwip: compact ? 50 : 0,
      beforePt: 0,
      afterPt: compact ? 1 : theme.spacingPt.paragraph,
    },
    heading2: {
      color: docxColor(compact ? '#000000' : theme.color.accent),
      fontSizePt: compact ? 11 : theme.sizePt.sectionHeading,
      bold: true,
      letterSpacingTwip: compact ? 40 : 0,
      beforePt: compact ? 10 : theme.spacingPt.section,
      afterPt: compact ? 5 : 0,
      underline: compact || theme.rules.sectionUnderline,
    },
  }
}

function renderLocalCvFontFaces(theme: CvTheme) {
  const families = [...new Set([theme.fonts.heading, theme.fonts.body, theme.fonts.mono])]
    .filter(isCvGoogleFont)

  return families.flatMap((font) => ([400, 700] as const).map((weight) => `
    @font-face {
      font-family: "${font}";
      font-style: normal;
      font-weight: ${weight};
      font-display: block;
      src: url("${localCvFontDataUrl(font, weight)}") format("woff2");
    }
  `)).join('')
}

function localCvFontDataUrl(font: typeof cvFontOptions[number], weight: 400 | 700) {
  const key = `${font}:${weight}`
  const cached = cvFontDataCache.get(key)
  if (cached) return cached

  const source = cvFontPackages[font]
  const relativePath = join(
    'node_modules',
    source.packageName,
    'files',
    `${source.filePrefix}-latin-${weight}-normal.woff2`,
  )
  const fontPath = [
    resolve(process.cwd(), relativePath),
    resolve(process.cwd(), '..', relativePath),
  ].find(existsSync)
  if (!fontPath) {
    throw new Error(`Bundled CV font is missing: ${font} ${weight}`)
  }
  const dataUrl = `data:font/woff2;base64,${readFileSync(fontPath).toString('base64')}`
  cvFontDataCache.set(key, dataUrl)
  return dataUrl
}

function text(value: string) {
  return { type: 'text', text: value }
}

function paragraph(value: string) {
  return { type: 'paragraph', content: value ? [text(value)] : [] }
}

function heading(level: 1 | 2 | 3, value: string) {
  return { type: 'heading', attrs: { level }, content: [text(value)] }
}

function bulletList(items: string[]) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraph(item)],
    })),
  }
}

function table(rows: unknown[]) {
  return { type: 'table', content: rows }
}

function row(cells: unknown[]) {
  return { type: 'tableRow', content: cells }
}

function cell(content: unknown[]) {
  return { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content }
}
