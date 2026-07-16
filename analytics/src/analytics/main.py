import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncpg
from fastapi import FastAPI, Request
from pydantic_ai import Agent, Tool, UsageLimits
from pydantic_ai.ui.vercel_ai import VercelAIAdapter

from .prompt import instructions_for_today
from .sql_tool import AnalyticsDeps, run_sql


REQUEST_LIMITS = UsageLimits(request_limit=8)


def build_agent(model: str = "deepseek:deepseek-chat") -> Agent[AnalyticsDeps, str]:
    return Agent(
        model,
        deps_type=AnalyticsDeps,
        tools=[Tool(run_sql, name="sql")],
        defer_model_check=True,
    )


def create_app(
    *,
    agent: Agent[AnalyticsDeps, str] | None = None,
    deps: AnalyticsDeps | None = None,
) -> FastAPI:
    chat_agent = agent or build_agent()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if deps is not None:
            app.state.analytics_deps = deps
            yield
            return

        database_url = os.environ.get("CHAT_DATABASE_URL")
        if not database_url:
            raise RuntimeError("CHAT_DATABASE_URL is not set")

        pool = await asyncpg.create_pool(
            database_url,
            min_size=1,
            max_size=4,
            command_timeout=15,
        )
        app.state.analytics_deps = AnalyticsDeps(pool=pool)
        try:
            yield
        finally:
            await pool.close()

    api = FastAPI(title="AI Job Analytics", lifespan=lifespan)

    @api.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @api.post("/chat")
    async def chat(request: Request):
        return await VercelAIAdapter.dispatch_request(
            request,
            agent=chat_agent,
            sdk_version=6,
            manage_system_prompt="server",
            instructions=instructions_for_today(),
            deps=request.app.state.analytics_deps,
            usage_limits=REQUEST_LIMITS,
        )

    return api


app = create_app()
