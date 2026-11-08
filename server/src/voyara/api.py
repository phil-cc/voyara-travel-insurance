"""REST routes used by the voyara.com.au quote pages (and by the WebMCP tools running on them)."""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import destinations, products, rules
from .catalogue import CATALOGUE_VERSION, Pack, Region, Tier
from .quotes import NotFoundError, QuoteService
from .rules import RuleError

Channel = Literal["web", "webmcp"]
Age = Annotated[int, Field(ge=0, le=120)]
Excess = Literal[0, 100, 200, 250, 500]
ChannelHeader = Annotated[Channel, Header(alias="X-Voyara-Channel")]


class EligibilityRequest(BaseModel):
    traveller_ages: list[Age]


class CreateQuoteRequest(BaseModel):
    destination: str | None = Field(None, description="Allow-listed destination name, e.g. 'Japan'")
    destination_region: Region | None = None
    start_date: date
    end_date: date
    traveller_ages: list[Age]
    tier: Tier
    excess: Excess | None = None
    packs: list[Pack] = []


class UpdateQuoteRequest(BaseModel):
    tier: Tier | None = None
    excess: Excess | None = None
    packs: list[Pack] | None = None


async def rule_error_handler(_: Request, err: RuleError) -> JSONResponse:
    status = 404 if isinstance(err, NotFoundError) else 422
    return JSONResponse({"error": str(err), **err.details}, status_code=status)


def build_router(service: QuoteService) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/destinations")
    def list_destinations() -> dict:
        return {"destinations": destinations.names()}

    @router.get("/tiers")
    def list_tiers() -> dict:
        return products.list_policy_tiers()

    @router.get("/compare")
    def compare(tiers: Annotated[list[Tier], Query()]) -> dict:
        return products.compare_tiers(tiers)

    @router.get("/inclusions/{inclusion}")
    def explain(inclusion: str, tier: Tier) -> dict:
        return products.explain_inclusion(inclusion, tier)

    @router.post("/eligibility")
    def eligibility(body: EligibilityRequest) -> dict:
        return {**rules.check_eligibility(body.traveller_ages), "catalogue_version": CATALOGUE_VERSION}

    @router.post("/quotes")
    def create_quote(body: CreateQuoteRequest, channel: ChannelHeader = "web") -> dict:
        region = body.destination_region
        if body.destination is not None:
            region = destinations.resolve(body.destination)
            if region is None:
                raise RuleError(f"Destination '{body.destination}' is not on the Voyara destination list")
        if region is None:
            raise RuleError("Provide a destination or a destination_region")
        return service.create_quote(
            region, body.start_date, body.end_date, body.traveller_ages, body.tier, body.excess, body.packs,
            channel=channel, destination=body.destination,
        )

    @router.patch("/quotes/{quote_id}")
    def update_quote(quote_id: str, body: UpdateQuoteRequest, channel: ChannelHeader = "web") -> dict:
        return service.update_quote(quote_id, body.tier, body.excess, body.packs, channel=channel)

    @router.get("/quotes/{quote_id}")
    def get_quote(quote_id: str) -> dict:
        return service.get_quote(quote_id)

    @router.post("/quotes/{quote_id}/checkout")
    def start_checkout(quote_id: str, channel: ChannelHeader = "web") -> dict:
        return service.start_checkout(quote_id, channel=channel)

    @router.get("/checkout/{session_id}")
    def get_checkout(session_id: str) -> dict:
        return service.get_checkout(session_id)

    return router
