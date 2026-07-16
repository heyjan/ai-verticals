import { expect, test, type Page } from '@playwright/test'

const session = {
  user: {
    id: 1,
    name: 'Data Chat Tester',
    email: 'data-chat@example.com',
    avatarUrl: null,
    role: 'user',
    provider: 'webauthn',
  },
  loggedInAt: new Date(0).toISOString(),
}

async function mockSession(page: Page, authenticated: boolean) {
  if (authenticated) {
    await page.addInitScript((mockSession) => {
      let nuxtPayload: any
      Object.defineProperty(window, '__NUXT__', {
        configurable: true,
        get: () => nuxtPayload,
        set: (value) => {
          value.state ||= {}
          value.state['$snuxt-session'] = mockSession
          nuxtPayload = value
        },
      })
    }, session)
  }

  await page.route('**/api/_auth/session', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(authenticated ? session : {}),
    }),
  )
}

async function mockStreamingChat(page: Page) {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url

      if (!url.endsWith('/api/chat')) {
        return nativeFetch(input, init)
      }

      const encoder = new TextEncoder()
      const chunks = [
        { type: 'start', messageId: 'assistant-1' },
        { type: 'start-step' },
        {
          type: 'tool-input-available',
          toolCallId: 'sql-1',
          toolName: 'sql',
          input: {
            query: "SELECT company, count(*) FROM jobs WHERE active = true AND city = 'Berlin' GROUP BY company LIMIT 200",
          },
        },
        {
          type: 'tool-output-available',
          toolCallId: 'sql-1',
          output: {
            rowCount: 2,
            truncated: false,
            rows: [
              { company: 'Example AG', count: 4 },
              { company: 'Sample GmbH', count: 2 },
            ],
          },
        },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'I found **two companies** ' },
        { type: 'text-delta', id: 'text-1', delta: 'with matching active postings.' },
        { type: 'text-end', id: 'text-1' },
        { type: 'finish-step' },
        { type: 'finish' },
      ]

      const stream = new ReadableStream({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
            await new Promise(resolve => setTimeout(resolve, 40))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'x-vercel-ai-ui-message-stream': 'v1',
        },
      })
    }
  })
}

test.describe('Data Chat', () => {
  test('requires login in the page and API', async ({ page, request }) => {
    await mockSession(page, false)
    await page.goto('/data-chat')

    await expect(page.getByRole('heading', { name: 'Data Chat' })).toBeVisible()
    await expect(page.getByText('Login is required to query the jobs dataset.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')

    const response = await request.post('/api/chat', {
      data: {
        id: 'unauthenticated',
        trigger: 'submit-message',
        messages: [],
      },
    })
    expect(response.status()).toBe(401)
  })

  test('streams markdown and exposes the SQL query and row count', async ({ page }) => {
    await mockSession(page, true)
    await mockStreamingChat(page)
    await page.goto('/data-chat')

    const example = page.getByRole('button', {
      name: 'Which companies mention LangChain in Berlin?',
    })
    await expect(example).toBeVisible()
    await example.click()

    await expect(page.getByText('streaming', { exact: true })).toBeVisible()
    await expect(page.getByText('I found two companies with matching active postings.')).toBeVisible()
    await expect(page.getByText('2 rows')).toBeVisible()

    await page.getByText('ran SQL').click()
    await expect(page.getByText(/SELECT company, count\(\*\)/)).toBeVisible()
    await expect(page.getByText('ready', { exact: true })).toBeVisible()

    await page.screenshot({
      path: 'e2e/screenshots/data-chat/desktop.png',
      fullPage: true,
    })
  })

  test('keeps the composer usable on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockSession(page, true)
    await page.goto('/data-chat')

    await expect(page.getByRole('textbox', { name: 'Data chat prompt' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send prompt' })).toBeVisible()
    await expect(page.getByRole('button', {
      name: 'How did agent-engineering postings trend since January?',
    })).toBeVisible()

    await page.screenshot({
      path: 'e2e/screenshots/data-chat/mobile.png',
      fullPage: true,
    })
  })
})
