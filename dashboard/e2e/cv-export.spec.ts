import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getCvTemplate,
  renderCvDocx,
  renderCvHtml,
  renderCvPdf,
} from '../server/utils/cv-builder'

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const screenshotDirectory = resolve(dashboardRoot, 'e2e/screenshots/cv-export')
const artifactDirectory = resolve(dashboardRoot, 'test-results/cv-export')

const content = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1, textAlign: 'center' },
      content: [{ type: 'text', text: 'JANE EXAMPLE' }],
    },
    {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: 'AI / FULL STACK DEVELOPER' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'PROFESSIONAL EXPERIENCE' }],
    },
    {
      type: 'table',
      attrs: { borderless: true },
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1, colwidth: [190] },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '2024 - present' }] }],
            },
            {
              type: 'tableCell',
              attrs: { colspan: 1, rowspan: 1, colwidth: [410] },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Senior AI Developer' },
                    { type: 'text', text: ' | Example GmbH' },
                  ],
                },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Built reliable AI workflows and production quality gates.' }],
                      }],
                    },
                    {
                      type: 'listItem',
                      content: [{
                        type: 'paragraph',
                        content: [{
                          type: 'text',
                          marks: [{ type: 'textStyle', attrs: { fontSize: '9pt' } }],
                          text: 'Aligned engineering delivery with business requirements.',
                        }],
                      }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'SKILLS' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'TypeScript, Python, SQL, ' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          text: 'portfolio',
        },
      ],
    },
  ],
}

test('PDF and DOCX exports preserve the same CV typography', async ({ page }) => {
  const template = getCvTemplate('tmpl_compact_executive_grid')
  expect(template).toBeTruthy()
  if (!template) return
  const theme = structuredClone(template.theme)
  theme.fonts = { heading: 'Lato', body: 'Lato', mono: 'Lato' }

  await Promise.all([
    mkdir(screenshotDirectory, { recursive: true }),
    mkdir(artifactDirectory, { recursive: true }),
  ])

  const params = {
    title: 'CV export parity fixture',
    templateId: template.id,
    content,
    page: template.page,
    theme,
  }
  const html = renderCvHtml(params)
  const [pdf, docx] = await Promise.all([
    renderCvPdf(html, template.page),
    renderCvDocx(params),
  ])

  await Promise.all([
    writeFile(resolve(artifactDirectory, 'cv-export-parity.pdf'), pdf),
    writeFile(resolve(artifactDirectory, 'cv-export-parity.docx'), docx),
  ])

  const zip = await JSZip.loadAsync(docx)
  const stylesXml = await zip.file('word/styles.xml')?.async('string')
  const documentXml = await zip.file('word/document.xml')?.async('string')
  expect(stylesXml).toContain('w:styleId="CvHeading2"')
  expect(stylesXml).toContain('<w:color w:val="000000"')
  expect(stylesXml).toContain('<w:sz w:val="22"')
  expect(stylesXml).not.toContain('w:themeColor="accent1"')
  expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"')
  expect(documentXml).toContain('<w:pStyle w:val="CvHeading2"')

  await page.emulateMedia({ media: 'print' })
  await page.setContent(html, { waitUntil: 'load' })
  const pdfHeading = page.getByText('PROFESSIONAL EXPERIENCE', { exact: true })
  await expect(pdfHeading).toBeVisible()
  const pdfStyle = await typography(pdfHeading)
  const pdfNameStyle = await typography(page.getByText('JANE EXAMPLE', { exact: true }))
  const pdfBodyStyle = await typography(page.getByText('2024 - present', { exact: true }))

  const pdfModulePath = resolve(dashboardRoot, '../node_modules/pdfjs-dist/legacy/build/pdf.mjs')
  const pdfWorkerPath = resolve(dashboardRoot, '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  await page.route('http://cv-export.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/pdf.mjs') {
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(pdfModulePath) })
      return
    }
    if (path === '/pdf.worker.mjs') {
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(pdfWorkerPath) })
      return
    }
    await route.fulfill({
      contentType: 'text/html',
      body: '<style>html,body{margin:0;background:#888}canvas{display:block;margin:0 auto;background:#fff}</style><canvas id="pdf-page"></canvas>',
    })
  })
  await page.goto('http://cv-export.test/')
  await page.evaluate(async (base64) => {
    const pdfjs = await import('/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'
    const data = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const pdfDocument = await pdfjs.getDocument({ data }).promise
    const pdfPage = await pdfDocument.getPage(1)
    const viewport = pdfPage.getViewport({ scale: 4 / 3 })
    const canvas = document.querySelector<HTMLCanvasElement>('#pdf-page')
    if (!canvas) throw new Error('PDF canvas is missing')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('PDF canvas context is unavailable')
    await pdfPage.render({ canvas, canvasContext: context, viewport }).promise
  }, pdf.toString('base64'))
  const pdfScreenshot = await page.locator('#pdf-page').screenshot({
    path: resolve(screenshotDirectory, 'pdf.png'),
  })

  await page.setContent('<main id="docx-container"></main>')
  await page.addScriptTag({ path: resolve(dashboardRoot, '../node_modules/jszip/dist/jszip.min.js') })
  await page.addScriptTag({ path: resolve(dashboardRoot, '../node_modules/docx-preview/dist/docx-preview.min.js') })
  await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
    const renderer = (window as any).docx
    await renderer.renderAsync(
      bytes.buffer,
      document.querySelector('#docx-container'),
      null,
      { breakPages: true, ignoreFonts: false, useBase64URL: true },
    )
  }, docx.toString('base64'))

  const docxHeading = page.getByText('PROFESSIONAL EXPERIENCE', { exact: true })
  await expect(docxHeading).toBeVisible()
  const docxStyle = await typography(docxHeading)
  const docxNameStyle = await typography(page.getByText('JANE EXAMPLE', { exact: true }))
  const docxBodyStyle = await typography(page.getByText('2024 - present', { exact: true }))
  const docxPage = page.locator('section.docx').first()
  await expect(docxPage).toBeVisible()
  const docxScreenshot = await docxPage.screenshot({
    path: resolve(screenshotDirectory, 'docx.png'),
  })

  expectTypographyToMatch(docxStyle, pdfStyle)
  expectTypographyToMatch(docxNameStyle, pdfNameStyle)
  expectTypographyToMatch(docxBodyStyle, pdfBodyStyle)
  expect(pngDimensions(docxScreenshot)).toEqual(pngDimensions(pdfScreenshot))
})

async function typography(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      color: style.color,
      fontSize: Number.parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      fontFamily: style.fontFamily,
    }
  })
}

function expectTypographyToMatch(
  docxStyle: Awaited<ReturnType<typeof typography>>,
  pdfStyle: Awaited<ReturnType<typeof typography>>,
) {
  expect(docxStyle.color).toBe(pdfStyle.color)
  expect(Math.abs(docxStyle.fontSize - pdfStyle.fontSize)).toBeLessThan(1)
  expect(docxStyle.fontWeight).toBe(pdfStyle.fontWeight)
  expect(docxStyle.fontFamily).toContain('Lato')
  expect(pdfStyle.fontFamily).toContain('Lato')
}

function pngDimensions(data: Buffer) {
  expect(data.subarray(1, 4).toString()).toBe('PNG')
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  }
}
