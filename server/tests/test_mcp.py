import json

import pytest
from mcp import Client

from voyara.mcp_server import build_mcp

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def data(result) -> dict:
    assert not result.is_error, result.content
    if result.structured_content is not None:
        return result.structured_content
    return json.loads(result.content[0].text)


async def test_lists_all_nine_tools(service):
    async with Client(build_mcp(service)) as client:
        tools = {t.name for t in (await client.list_tools()).tools}
    assert tools == {
        "list_policy_tiers", "compare_tiers", "explain_inclusion", "check_eligibility", "recommend_tier",
        "create_quote", "update_quote", "get_quote", "start_checkout",
    }


# R-02
async def test_list_policy_tiers_returns_four_tiers(service):
    async with Client(build_mcp(service)) as client:
        result = data(await client.call_tool("list_policy_tiers", {}))
    assert [t["name"] for t in result["tiers"]] == ["Essentials", "Explorer", "Comprehensive", "Elite"]
    assert result["tiers"][0]["headline_limits"]["Overseas medical and hospital"] == "$5m"


async def test_story1_priya_end_to_end(service):
    async with Client(build_mcp(service)) as client:
        elig = data(await client.call_tool("check_eligibility", {"traveller_ages": [27], "destination_region": "asia"}))
        assert elig["eligible_tiers"] == ["essentials", "explorer", "comprehensive", "elite"]

        rec = data(await client.call_tool("recommend_tier", {
            "activities": ["trekking"], "trip_cost": 0, "cruise": False, "rental_car": False,
            "ages": [27], "max_trek_altitude_m": 5364,
        }))
        assert (rec["recommended_tier"], rec["packs"]) == ("explorer", ["adventure"])

        quote = data(await client.call_tool("create_quote", {
            "destination_region": "asia", "start_date": "2027-04-01", "end_date": "2027-04-21",
            "traveller_ages": [27], "tier": "explorer", "packs": ["adventure"],
        }))
        assert quote["premium"]["total"] == "312.00"
        assert "general_advice_warning" in quote["disclosure"]  # R-05

        cmp = data(await client.call_tool("compare_tiers", {"tiers": ["explorer", "comprehensive"]}))
        rental = next(r for r in cmp["matrix"] if r["inclusion"] == "rental_vehicle_excess")
        assert (rental["explorer"], rental["comprehensive"]) == ("Not covered", "$5,000")

        checkout = data(await client.call_tool("start_checkout", {"quote_id": quote["quote_id"]}))
        assert "/checkout/?session=" in checkout["checkout_url"]


# R-03 via MCP
async def test_gadget_pack_on_explorer_is_a_tool_error(service):
    async with Client(build_mcp(service)) as client:
        result = await client.call_tool("create_quote", {
            "destination_region": "asia", "start_date": "2027-04-01", "end_date": "2027-04-21",
            "traveller_ages": [27], "tier": "explorer", "packs": ["gadget"],
        })
    assert result.is_error
    assert result.content[0].text.endswith("Gadget Pack requires Comprehensive or above")


# R-04 via MCP
async def test_age_78_elite_reports_highest_eligible_tier(service):
    async with Client(build_mcp(service)) as client:
        result = await client.call_tool("create_quote", {
            "destination_region": "pacific", "start_date": "2027-04-01", "end_date": "2027-04-21",
            "traveller_ages": [78], "tier": "elite",
        })
    assert result.is_error
    assert "highest_eligible_tier: comprehensive" in result.content[0].text


async def test_resources_and_prompt(service):
    async with Client(build_mcp(service)) as client:
        pds = await client.read_resource("voyara://pds/explorer")
        assert "Explorer" in pds.contents[0].text
        tmd = await client.read_resource("voyara://tmd")
        assert "Target Market Determination" in tmd.contents[0].text
        prompt = await client.get_prompt("find_my_cover")
        assert "destination" in prompt.messages[0].content.text


async def test_mcp_quotes_record_channel(service):
    async with Client(build_mcp(service)) as client:
        quote = data(await client.call_tool("create_quote", {
            "destination_region": "asia", "start_date": "2027-04-01", "end_date": "2027-04-21",
            "traveller_ages": [27], "tier": "explorer",
        }))
    assert quote["channel"] == "mcp"
