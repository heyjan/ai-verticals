from types import SimpleNamespace
from typing import Any

import pytest

from analytics.sql_tool import AnalyticsDeps, MAX_ROWS, run_sql


class FakeTransaction:
    def __init__(self, connection: "FakeConnection", readonly: bool):
        self.connection = connection
        self.readonly = readonly

    async def __aenter__(self):
        self.connection.readonly = self.readonly

    async def __aexit__(self, *_args):
        return None


class FakeConnection:
    def __init__(self, rows: list[dict[str, Any]], error: Exception | None = None):
        self.rows = rows
        self.error = error
        self.readonly = False
        self.commands: list[str] = []
        self.query = ""

    def transaction(self, *, readonly: bool):
        return FakeTransaction(self, readonly)

    async def execute(self, command: str):
        self.commands.append(command)

    async def fetch(self, query: str):
        self.query = query
        if self.error:
            raise self.error
        return self.rows


class FakeAcquire:
    def __init__(self, connection: FakeConnection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


class FakePool:
    def __init__(self, connection: FakeConnection):
        self.connection = connection

    def acquire(self):
        return FakeAcquire(self.connection)


def context_for(connection: FakeConnection):
    deps = AnalyticsDeps(pool=FakePool(connection))  # type: ignore[arg-type]
    return SimpleNamespace(deps=deps)


@pytest.mark.asyncio
async def test_sql_tool_is_readonly_times_out_and_caps_rows():
    rows = [{"id": index} for index in range(MAX_ROWS + 3)]
    connection = FakeConnection(rows)

    result = await run_sql(context_for(connection), " SELECT * FROM jobs ")

    assert connection.readonly is True
    assert connection.commands == ["SET LOCAL statement_timeout = '10000ms'"]
    assert connection.query == "SELECT * FROM jobs"
    assert result["rowCount"] == MAX_ROWS + 3
    assert result["truncated"] is True
    assert len(result["rows"]) == MAX_ROWS


@pytest.mark.asyncio
async def test_sql_tool_returns_errors_to_the_model():
    connection = FakeConnection([], error=RuntimeError("permission denied"))

    result = await run_sql(context_for(connection), "SELECT * FROM users")

    assert result == "SQL error: permission denied"


@pytest.mark.asyncio
async def test_sql_tool_rejects_empty_query():
    connection = FakeConnection([])

    result = await run_sql(context_for(connection), "   ")

    assert result == "SQL error: query must not be empty"
