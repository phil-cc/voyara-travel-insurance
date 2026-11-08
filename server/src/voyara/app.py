"""Compose the Quote API (REST at /api) and the MCP server (Streamable HTTP at /mcp) in one ASGI app."""

import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from .api import build_router, rule_error_handler
from .mcp_server import build_mcp
from .quotes import QuoteService
from .ratelimit import RateLimitMiddleware
from .rules import RuleError


def create_app(service: QuoteService | None = None, **rate_limit) -> FastAPI:
    service = service or QuoteService(web_base_url=os.environ.get("VOYARA_WEB_BASE_URL", "http://localhost:5173"))
    mcp = build_mcp(service)
    mcp_app = mcp.streamable_http_app(stateless_http=True, json_response=True)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        async with mcp.session_manager.run():
            yield

    app = FastAPI(title="Voyara Quote API", lifespan=lifespan)
    app.state.service = service
    app.add_exception_handler(RuleError, rule_error_handler)
    app.include_router(build_router(service))
    app.add_middleware(RateLimitMiddleware, **rate_limit)
    app.mount("/", mcp_app)  # serves /mcp
    return app


def main() -> None:
    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
