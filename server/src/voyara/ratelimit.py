"""Per-client sliding-window rate limit for the public MCP endpoint (R-12)."""

import json
import math
import time
from collections import defaultdict, deque
from collections.abc import Callable

from starlette.types import ASGIApp, Receive, Scope, Send


class RateLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        path_prefix: str = "/mcp",
        limit: int = 60,
        window_seconds: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.app = app
        self.path_prefix = path_prefix
        self.limit = limit
        self.window = window_seconds
        self.clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(self.path_prefix):
            await self.app(scope, receive, send)
            return

        # Phase 1 has no credentials, so the client is identified by IP address.
        client = scope.get("client")
        key = client[0] if client else "unknown"
        now = self.clock()
        hits = self._hits[key]
        while hits and hits[0] <= now - self.window:
            hits.popleft()

        if len(hits) >= self.limit:
            retry_after = max(1, math.ceil(hits[0] + self.window - now))
            body = json.dumps({"error": "Rate limit exceeded", "retry_after_seconds": retry_after}).encode()
            await send({
                "type": "http.response.start",
                "status": 429,
                "headers": [(b"content-type", b"application/json"), (b"retry-after", str(retry_after).encode())],
            })
            await send({"type": "http.response.body", "body": body})
            return

        hits.append(now)
        await self.app(scope, receive, send)
