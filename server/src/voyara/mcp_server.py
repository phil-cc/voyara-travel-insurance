"""Voyara MCP server: a thin wrapper over QuoteService and the catalogue views."""

from collections.abc import Callable
from datetime import date
from functools import wraps
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ResourceNotFoundError, ToolError
from mcp.types import ToolAnnotations
from pydantic import Field

from . import products, rules
from .catalogue import CATALOGUE_VERSION, INCLUSIONS, TIERS, TMD_TEXT, Pack, Region, Tier, pds_section_text
from .quotes import QuoteService
from .rules import RuleError

Inclusion = Literal[tuple(INCLUSIONS)]  # type: ignore[valid-type]
Activity = Literal[tuple(rules.ACTIVITIES)]  # type: ignore[valid-type]
Excess = Literal[0, 100, 200, 250, 500]
Age = Annotated[int, Field(ge=0, le=120)]

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITES = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)

INSTRUCTIONS = (
    "Voyara is a fictitious Australian travel insurer. Use these tools to explain policy tiers and price trips. "
    "Whenever you show a price, show the disclosure text and links too. Tier recommendations are general advice "
    "only: never tell the customer a policy is right for them. You cannot buy a policy. start_checkout returns a "
    "link the customer opens to review and pay themselves."
)


def _client_name(ctx: Context) -> str | None:
    params = getattr(ctx.session, "client_params", None)
    info = getattr(params, "client_info", None)
    return getattr(info, "name", None)


def _rule_errors_as_tool_errors(fn: Callable) -> Callable:
    @wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except RuleError as err:
            detail = "".join(f" ({k}: {v})" for k, v in err.details.items() if k == "highest_eligible_tier")
            raise ToolError(f"{err}{detail}") from err

    return wrapper


def build_mcp(service: QuoteService) -> MCPServer:
    mcp = MCPServer(name="voyara", title="Voyara Travel Insurance", version="0.1.0", instructions=INSTRUCTIONS)

    @mcp.tool(annotations=READ_ONLY)
    @_rule_errors_as_tool_errors
    async def list_policy_tiers() -> dict[str, Any]:
        """List Voyara's four policy tiers with headline limits, available add-on packs and a starting price."""
        return products.list_policy_tiers()

    @mcp.tool(annotations=READ_ONLY)
    @_rule_errors_as_tool_errors
    async def compare_tiers(tiers: list[Tier], inclusions: list[Inclusion] | None = None) -> dict[str, Any]:
        """Compare inclusions side by side for the given tiers. Omit inclusions to compare everything."""
        return products.compare_tiers(tiers, inclusions)

    @mcp.tool(annotations=READ_ONLY)
    @_rule_errors_as_tool_errors
    async def explain_inclusion(inclusion: Inclusion, tier: Tier) -> dict[str, Any]:
        """Explain one inclusion in plain English for a tier: what it covers, the limit, key exclusions and the PDS section."""
        return products.explain_inclusion(inclusion, tier)

    @mcp.tool(annotations=READ_ONLY)
    @_rule_errors_as_tool_errors
    async def check_eligibility(traveller_ages: list[Age], destination_region: Region) -> dict[str, Any]:
        """Check which tiers the travellers can buy. Travellers aged 75 to 85 can buy up to Comprehensive and need a medical assessment. Travellers aged 86 or over are not eligible."""
        return {
            **rules.check_eligibility(traveller_ages),
            "destination_region": destination_region,
            "catalogue_version": CATALOGUE_VERSION,
        }

    @mcp.tool(annotations=READ_ONLY)
    @_rule_errors_as_tool_errors
    async def recommend_tier(
        activities: list[Activity],
        trip_cost: Annotated[float, Field(ge=0, description="Total prepaid, non-refundable trip cost in AUD")],
        cruise: bool,
        rental_car: bool,
        ages: list[Age],
        max_dive_depth_m: float | None = None,
        max_trek_altitude_m: float | None = None,
    ) -> dict[str, Any]:
        """Match trip features to the lowest tier and packs that cover them. General advice only: the result follows product rules and does not consider personal circumstances."""
        return {
            **rules.recommend_tier(
                activities, trip_cost, cruise, rental_car, ages, max_dive_depth_m, max_trek_altitude_m
            ),
            "catalogue_version": CATALOGUE_VERSION,
        }

    @mcp.tool(annotations=WRITES)
    @_rule_errors_as_tool_errors
    async def create_quote(
        destination_region: Region,
        start_date: date,
        end_date: date,
        traveller_ages: list[Age],
        tier: Tier,
        ctx: Context,
        excess: Excess | None = None,
        packs: list[Pack] | None = None,
    ) -> dict[str, Any]:
        """Price a trip and save the quote for 7 days. Excess defaults to the tier's standard excess. Show the disclosure with the price."""
        return service.create_quote(
            destination_region, start_date, end_date, traveller_ages, tier, excess, packs,
            channel="mcp", client_name=_client_name(ctx),
        )

    @mcp.tool(annotations=WRITES)
    @_rule_errors_as_tool_errors
    async def update_quote(
        quote_id: str,
        ctx: Context,
        tier: Tier | None = None,
        excess: Excess | None = None,
        packs: list[Pack] | None = None,
    ) -> dict[str, Any]:
        """Change the tier, excess or packs on an active quote and re-price it. Passing packs replaces the whole pack list."""
        return service.update_quote(quote_id, tier, excess, packs, channel="mcp", client_name=_client_name(ctx))

    @mcp.tool(annotations=READ_ONLY)
    @_rule_errors_as_tool_errors
    async def get_quote(quote_id: str) -> dict[str, Any]:
        """Retrieve a saved quote. Quotes expire after 7 days; an expired quote returns the inputs needed to re-quote."""
        return service.get_quote(quote_id)

    @mcp.tool(annotations=WRITES)
    @_rule_errors_as_tool_errors
    async def start_checkout(quote_id: str, ctx: Context) -> dict[str, Any]:
        """Create a checkout link (valid for 30 minutes) for the customer to review and pay. You cannot complete payment."""
        return service.start_checkout(quote_id, channel="mcp", client_name=_client_name(ctx))

    @mcp.resource("voyara://pds/{tier}", mime_type="text/plain", description="Product Disclosure Statement extract for a tier")
    def pds(tier: str) -> str:
        if tier not in TIERS:
            raise ResourceNotFoundError(f"Unknown tier '{tier}'")
        return pds_section_text(tier)

    @mcp.resource("voyara://tmd", mime_type="text/plain", description="Target Market Determination")
    def tmd() -> str:
        return TMD_TEXT

    @mcp.prompt(description="Gather trip details before quoting travel insurance")
    def find_my_cover() -> str:
        return (
            "Help me find Voyara travel insurance. Before quoting, ask me for: destination, travel dates, the age of "
            "every traveller, planned activities (scuba, skydiving, trekking, skiing, snowboarding), whether it is an "
            "ocean cruise, whether I will hire a car, and my total prepaid trip cost. Then call check_eligibility, "
            "recommend_tier and create_quote. Show the disclosure with every price, and remind me that the "
            "recommendation is general advice."
        )

    return mcp
