import { test, expect } from '@playwright/test'

const firstFamily = (fontFamily: string) =>
  fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, '')

test.describe('Inter Tight heading font', () => {
  test('google fonts stylesheet with Inter Tight is linked', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    const href = await page
      .locator('link[rel="stylesheet"][href*="fonts.googleapis.com"]')
      .first()
      .getAttribute('href')
    expect(href).toBeTruthy()
    expect(href).toContain('Inter+Tight')
  })

  test('h1 and h2 on landing page use Inter Tight with sans-serif fallback', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    const h1 = page.locator('h1').first()
    await expect(h1).toBeVisible()
    const h1Family = await h1.evaluate(el => getComputedStyle(el).fontFamily)
    expect(firstFamily(h1Family)).toBe('Inter Tight')
    expect(h1Family.toLowerCase()).toContain('sans-serif')

    const h2 = page.locator('h2').first()
    await expect(h2).toBeVisible()
    const h2Family = await h2.evaluate(el => getComputedStyle(el).fontFamily)
    expect(firstFamily(h2Family)).toBe('Inter Tight')
    expect(h2Family.toLowerCase()).toContain('sans-serif')

    await page.screenshot({ path: 'e2e/screenshots/fonts-landing.png', fullPage: false })
  })

  test('h1 and h2 on impressum use Inter Tight', async ({ page }) => {
    await page.goto('/impressum', { waitUntil: 'networkidle' })

    for (const tag of ['h1', 'h2'] as const) {
      const el = page.locator(tag).first()
      await expect(el).toBeVisible()
      const family = await el.evaluate(node => getComputedStyle(node).fontFamily)
      expect(firstFamily(family)).toBe('Inter Tight')
    }
  })

  test('Inter Tight font face actually loads in the browser', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    const loaded = await page.evaluate(async () => {
      await document.fonts.ready
      // Force a load in case no glyph has been rasterized yet.
      await document.fonts.load('700 16px "Inter Tight"')
      return document.fonts.check('700 16px "Inter Tight"')
    })
    expect(loaded).toBe(true)
  })
})
