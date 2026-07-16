import type { Sql } from 'postgres'

export async function configureChatReadonlyRole(client: Sql) {
  const password = process.env.CHAT_RO_PASSWORD
  if (!password || !/^[A-Za-z0-9._~-]{16,}$/.test(password)) {
    throw new Error(
      'CHAT_RO_PASSWORD must contain at least 16 URL-safe characters (A-Z, a-z, 0-9, ., _, ~, -)',
    )
  }

  const passwordLiteral = password.replaceAll("'", "''")
  await client.unsafe(`ALTER ROLE chat_ro WITH LOGIN PASSWORD '${passwordLiteral}'`)
}
