export default defineEventHandler(async (event) => {
  await requireUserSession(event)

  const config = useRuntimeConfig(event)
  const target = `${String(config.analyticsUrl).replace(/\/$/, '')}/chat`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  const headers = new Headers(getProxyRequestHeaders(event))
  headers.delete('authorization')
  headers.delete('cookie')
  headers.set('accept', 'text/event-stream')

  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'x-accel-buffering', 'no')

  try {
    return await proxyRequest(event, target, {
      headers,
      sendStream: true,
      streamRequest: true,
      fetchOptions: {
        signal: controller.signal,
      },
    })
  } catch (error: any) {
    if (controller.signal.aborted) {
      throw createError({
        statusCode: 504,
        statusMessage: 'Analytics request timed out',
      })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
})
