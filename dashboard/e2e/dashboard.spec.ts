import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3000'

test.describe('Dashboard visual checks', () => {
  test('full page loads with all panels', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    await page.screenshot({ path: 'e2e/screenshots/01-full-page.png', fullPage: true })

    // Header with logo visible
    const logo = page.locator('img[alt="ai-verticals.dev"]')
    await expect(logo).toBeVisible()

    // Blueprint grid background is present
    const dash = page.locator('.blueprint-grid')
    await expect(dash).toBeVisible()

    // Status indicator shows green dot and ACTIVE
    const statusText = page.locator('text=ACTIVE')
    await expect(statusText).toBeVisible()

    // Green dot (emerald) not red
    const greenDot = page.locator('.bg-emerald-500')
    await expect(greenDot).toBeVisible()

    // Footer is visible with "built with <3"
    const footer = page.locator('text=built with')
    await expect(footer).toBeVisible()

    // Footer links
    const githubLink = page.locator('a[aria-label="GitHub"]')
    await expect(githubLink).toBeVisible()
    const linkedinLink = page.locator('a[aria-label="LinkedIn"]')
    await expect(linkedinLink).toBeVisible()
  })

  test('header is 60px, white, no wireframe grid', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    const header = page.locator('.dash-header')
    const box = await header.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.height).toBeCloseTo(60, -1)

    // Header background should be white
    const bgColor = await header.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(bgColor).toMatch(/rgb\(255,\s*255,\s*255\)/)

    await page.screenshot({ path: 'e2e/screenshots/02-header.png', clip: { x: 0, y: 0, width: 1280, height: 100 } })
  })

  test('logo renders fully (no cutoff)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    const logo = page.locator('img[alt="ai-verticals.dev"]')
    const box = await logo.boundingBox()
    expect(box).toBeTruthy()
    // Logo should be wider than 100px (not cut off)
    expect(box!.width).toBeGreaterThan(100)

    await page.screenshot({
      path: 'e2e/screenshots/03-logo.png',
      clip: { x: box!.x - 10, y: box!.y - 10, width: box!.width + 20, height: box!.height + 20 },
    })
  })

  test('panels and data load', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Stats panel
    const statsPanel = page.locator('text=SYS.overview')
    await expect(statsPanel).toBeVisible()

    // At least one stat value rendered
    const statValues = page.locator('.stat-value')
    await expect(statValues.first()).toBeVisible()
    const firstStat = await statValues.first().textContent()
    expect(firstStat).toBeTruthy()
    expect(firstStat).not.toBe('...')

    // Category panel
    await expect(page.locator('text=CAT.segments')).toBeVisible()

    // Cities panel
    await expect(page.locator('text=GEO.cities')).toBeVisible()

    // Levels panel
    await expect(page.locator('text=LVL.experience')).toBeVisible()

    // Companies panel
    await expect(page.locator('text=ORG.companies')).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/04-panels.png', fullPage: true })
  })

  test('footer is at bottom of content, not fixed', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    const footer = page.locator('.dash-footer')
    const position = await footer.evaluate(el => getComputedStyle(el).position)
    // Footer should NOT be fixed
    expect(position).not.toBe('fixed')

    await page.screenshot({ path: 'e2e/screenshots/05-footer.png', fullPage: true })
  })

  test('3D viewport renders canvas', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()

    const viewport = page.locator('.dash-viewport')
    const box = await viewport.boundingBox()
    if (box) {
      await page.screenshot({
        path: 'e2e/screenshots/06-viewport.png',
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      })
    }
  })

  test('3D map bars respond to hover', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(4000)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) {
      test.skip(true, 'Canvas not found')
      return
    }

    let tooltipFound = false
    const tooltip = page.locator('.tooltip-panel')

    for (let y = 0.3; y <= 0.7 && !tooltipFound; y += 0.02) {
      for (let x = 0.3; x <= 0.7 && !tooltipFound; x += 0.02) {
        await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
        await page.waitForTimeout(20)
        tooltipFound = await tooltip.isVisible().catch(() => false)
      }
    }

    expect(tooltipFound).toBe(true)
    await page.screenshot({ path: 'e2e/screenshots/07-tooltip-visible.png', fullPage: false })
  })
})
