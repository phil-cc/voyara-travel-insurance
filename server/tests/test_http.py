import pytest
from fastapi.testclient import TestClient

from voyara.app import create_app

MCP_HEADERS = {
    "accept": "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2025-06-18",
}
TRIP = {"start_date": "2027-04-01", "end_date": "2027-04-21", "traveller_ages": [27], "tier": "explorer", "packs": ["adventure"]}


class FakeMonotonic:
    def __init__(self):
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def limiter_clock():
    return FakeMonotonic()


@pytest.fixture
def client(service, limiter_clock):
    # The MCP SDK only accepts localhost Host headers with a port (DNS rebinding protection).
    with TestClient(create_app(service, clock=limiter_clock), base_url="http://localhost:8000") as c:
        yield c


def mcp_call(client, name: str, arguments: dict, request_id: int = 1):
    body = {"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    return client.post("/mcp", json=body, headers=MCP_HEADERS)


# R-01
def test_mcp_and_rest_premiums_match_to_the_cent(client):
    for ages, tier, packs in [([27], "explorer", ["adventure"]), ([42, 40, 10, 8], "comprehensive", ["snow"]), ([78], "comprehensive", ["cruise"])]:
        trip = {**TRIP, "traveller_ages": ages, "tier": tier, "packs": packs}
        via_mcp = mcp_call(client, "create_quote", {**trip, "destination_region": "asia"}).json()["result"]["structuredContent"]
        via_rest = client.post("/api/quotes", json={**trip, "destination": "Japan"}, headers={"X-Voyara-Channel": "webmcp"}).json()
        assert via_mcp["premium"] == via_rest["premium"]
        assert (via_mcp["channel"], via_rest["channel"]) == ("mcp", "webmcp")


def test_rest_defaults_to_web_channel_and_rejects_unknown_channel(client):
    assert client.post("/api/quotes", json={**TRIP, "destination": "Nepal"}).json()["channel"] == "web"
    bad = client.post("/api/quotes", json={**TRIP, "destination": "Nepal"}, headers={"X-Voyara-Channel": "mcp"})
    assert bad.status_code == 422


def test_rest_rule_errors(client):
    gadget = client.post("/api/quotes", json={**TRIP, "destination": "Nepal", "packs": ["gadget"]})
    assert (gadget.status_code, gadget.json()["error"]) == (422, "Gadget Pack requires Comprehensive or above")
    elite = client.post("/api/quotes", json={**TRIP, "destination": "Fiji", "traveller_ages": [78], "tier": "elite", "packs": []})
    assert elite.json()["highest_eligible_tier"] == "comprehensive"
    unknown = client.post("/api/quotes", json={**TRIP, "destination": "<script>"})
    assert unknown.status_code == 422
    assert client.get("/api/quotes/Q-00000").status_code == 404


def test_rest_update_get_and_checkout(client):
    quote = client.post("/api/quotes", json={**TRIP, "destination": "Nepal"}).json()
    updated = client.patch(f"/api/quotes/{quote['quote_id']}", json={"tier": "comprehensive"}).json()
    assert updated["premium"]["total"] == "408.00"
    assert client.get(f"/api/quotes/{quote['quote_id']}").json()["tier"] == "comprehensive"
    checkout = client.post(f"/api/quotes/{quote['quote_id']}/checkout").json()
    session = client.get(f"/api/checkout/{checkout['checkout_session_id']}").json()
    assert session["quote"]["quote_id"] == quote["quote_id"]


def test_rest_compare_and_explain(client):
    cmp = client.get("/api/compare", params=[("tiers", "explorer"), ("tiers", "comprehensive")]).json()
    rental = next(r for r in cmp["matrix"] if r["inclusion"] == "rental_vehicle_excess")
    assert (rental["explorer"], rental["comprehensive"]) == ("Not covered", "$5,000")
    explained = client.get("/api/inclusions/rental_vehicle_excess", params={"tier": "explorer"}).json()
    assert explained["limit"] == "Not covered"


# R-12
def test_mcp_rate_limit_returns_429_with_retry_after(client, limiter_clock):
    for i in range(60):
        assert mcp_call(client, "list_policy_tiers", {}, i).status_code == 200
    limited = mcp_call(client, "list_policy_tiers", {}, 61)
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "60"
    # The REST API used by the web pages is not limited by the MCP limiter.
    assert client.get("/api/tiers").status_code == 200
    limiter_clock.now += 60
    assert mcp_call(client, "list_policy_tiers", {}, 62).status_code == 200
