export default defineEventHandler((event) => {
  const host = getHeader(event, 'host') || ''
  const [hostname, port] = host.split(':')

  if (hostname !== '127.0.0.1' && hostname !== '0.0.0.0') return

  const target = new URL(getRequestURL(event))
  target.hostname = 'localhost'
  if (port) target.port = port

  return sendRedirect(event, target.toString(), 308)
})
