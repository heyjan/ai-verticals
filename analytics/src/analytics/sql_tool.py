from dataclasses import dataclass
from typing import Any

import asyncpg
from pydantic_ai import RunContext


MAX_ROWS = 200
STATEMENT_TIMEOUT_MS = 10_000


@dataclass
class AnalyticsDeps:
    pool: asyncpg.Pool


async def run_sql(
    ctx: RunContext[AnalyticsDeps],
    query: str,
) -> dict[str, Any] | str:
    """Run one read-only SQL query against the jobs analytics schema.

    The transaction is read only and has a ten-second statement timeout.
    At most 200 rows are returned to the model; `truncated` reports overflow.
    """
    statement = query.strip()
    if not statement:
        return "SQL error: query must not be empty"

    try:
        async with ctx.deps.pool.acquire() as connection:
            async with connection.transaction(readonly=True):
                await connection.execute(
                    f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT_MS}ms'"
                )
                records = await connection.fetch(statement)
    except Exception as error:
        return f"SQL error: {error}"

    rows = [dict(record) for record in records]
    return {
        "rowCount": len(rows),
        "truncated": len(rows) > MAX_ROWS,
        "rows": rows[:MAX_ROWS],
    }
