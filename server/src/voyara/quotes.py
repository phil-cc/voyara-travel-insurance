"""The shared Quote API. MCP tools and REST routes are thin wrappers over QuoteService."""

import secrets
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

from . import pricing, rules
from .catalogue import CATALOGUE_VERSION, EXCESS_OPTIONS, PACKS, REGIONS, STANDARD_EXCESS, TIERS, disclosure
from .rules import RuleError

QUOTE_TTL = timedelta(days=7)
CHECKOUT_TTL = timedelta(minutes=30)
MAX_TRIP_DAYS = 365


class NotFoundError(RuleError):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC)


class QuoteService:
    def __init__(self, web_base_url: str = "http://localhost:5173", clock: Callable[[], datetime] = utcnow):
        self.web_base_url = web_base_url.rstrip("/")
        self.clock = clock
        self._quotes: dict[str, dict] = {}
        self._checkouts: dict[str, dict] = {}

    # -- quotes ---------------------------------------------------------------

    def create_quote(
        self,
        destination_region: str,
        start_date: date,
        end_date: date,
        traveller_ages: list[int],
        tier: str,
        excess: int | None = None,
        packs: list[str] | None = None,
        *,
        channel: str,
        client_name: str | None = None,
        destination: str | None = None,
    ) -> dict:
        if destination_region not in REGIONS:
            raise RuleError(f"Unknown destination region '{destination_region}'")
        if tier not in TIERS:
            raise RuleError(f"Unknown tier '{tier}'")
        today = self.clock().date()
        if start_date < today:
            raise RuleError("Start date cannot be in the past")
        if end_date < start_date:
            raise RuleError("End date must be on or after the start date")
        if pricing.trip_days(start_date, end_date) > MAX_TRIP_DAYS:
            raise RuleError(f"Trips longer than {MAX_TRIP_DAYS} days cannot be quoted")
        eligibility = rules.assert_tier_eligible(tier, traveller_ages)

        now = self.clock()
        quote = {
            "quote_id": self._new_quote_id(),
            "destination": destination,
            "destination_region": destination_region,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "trip_days": pricing.trip_days(start_date, end_date),
            "traveller_ages": list(traveller_ages),
            "medical_assessment_required": eligibility["medical_assessment_required"],
            "created_at": now,
            "expires_at": now + QUOTE_TTL,
            "channel": channel,
            "client_name": client_name,
            "audit": [],
        }
        self._apply(quote, tier, STANDARD_EXCESS[tier] if excess is None else excess, packs or [])
        self._audit(quote, "create_quote", channel, client_name)
        self._quotes[quote["quote_id"]] = quote
        return self._view(quote)

    def update_quote(
        self,
        quote_id: str,
        tier: str | None = None,
        excess: int | None = None,
        packs: list[str] | None = None,
        *,
        channel: str,
        client_name: str | None = None,
    ) -> dict:
        quote = self._active(quote_id)
        new_tier = tier or quote["tier"]
        if new_tier not in TIERS:
            raise RuleError(f"Unknown tier '{new_tier}'")
        rules.assert_tier_eligible(new_tier, quote["traveller_ages"])
        if excess is None:
            # Keep a customised excess; follow the tier standard if the customer never changed it.
            excess = STANDARD_EXCESS[new_tier] if quote["excess"] == STANDARD_EXCESS[quote["tier"]] else quote["excess"]
        self._apply(quote, new_tier, excess, quote["packs"] if packs is None else packs)
        self._audit(quote, "update_quote", channel, client_name)
        return self._view(quote)

    def get_quote(self, quote_id: str) -> dict:
        quote = self._get(quote_id)
        if self._expired(quote):
            return {
                "quote_id": quote_id,
                "status": "expired",
                "expired_at": quote["expires_at"].isoformat(),
                "message": "This quote has expired. Create a new quote with the same trip details to re-price it.",
                "requote_inputs": {
                    "destination_region": quote["destination_region"],
                    "start_date": quote["start_date"],
                    "end_date": quote["end_date"],
                    "traveller_ages": quote["traveller_ages"],
                    "tier": quote["tier"],
                    "excess": quote["excess"],
                    "packs": quote["packs"],
                },
                "catalogue_version": CATALOGUE_VERSION,
            }
        return self._view(quote)

    # -- checkout -------------------------------------------------------------

    def start_checkout(self, quote_id: str, *, channel: str, client_name: str | None = None) -> dict:
        quote = self._active(quote_id)
        session_id = secrets.token_urlsafe(16)
        expires_at = self.clock() + CHECKOUT_TTL
        self._checkouts[session_id] = {"quote_id": quote_id, "expires_at": expires_at}
        self._audit(quote, "start_checkout", channel, client_name)
        return {
            "checkout_session_id": session_id,
            "checkout_url": f"{self.web_base_url}/checkout/?session={session_id}",
            "expires_at": expires_at.isoformat(),
            "message": "Give this link to the customer. They review the policy and press Pay themselves.",
            "quote": self._view(quote),
        }

    def get_checkout(self, session_id: str) -> dict:
        session = self._checkouts.get(session_id)
        if session is None:
            raise NotFoundError("Checkout session not found")
        if self.clock() >= session["expires_at"]:
            raise RuleError("Checkout session has expired. Start checkout again from the quote.")
        return {
            "checkout_session_id": session_id,
            "expires_at": session["expires_at"].isoformat(),
            "quote": self.get_quote(session["quote_id"]),
        }

    # -- internals ------------------------------------------------------------

    def _new_quote_id(self) -> str:
        while True:
            quote_id = f"Q-{10000 + secrets.randbelow(90000)}"
            if quote_id not in self._quotes:
                return quote_id

    def _apply(self, quote: dict, tier: str, excess: int, packs: list[str]) -> None:
        if excess not in EXCESS_OPTIONS:
            raise RuleError(f"Excess must be one of {EXCESS_OPTIONS}")
        packs = list(dict.fromkeys(packs))
        for pack in packs:
            if pack not in PACKS:
                raise RuleError(f"Unknown pack '{pack}'")
            rules.assert_pack_eligible(pack, tier)
        quote["tier"] = tier
        quote["excess"] = excess
        quote["packs"] = packs
        quote["premium"] = pricing.price(
            quote["destination_region"], quote["trip_days"], quote["traveller_ages"], tier, excess, packs
        )

    def _audit(self, quote: dict, action: str, channel: str, client_name: str | None) -> None:
        quote["audit"].append(
            {"at": self.clock().isoformat(), "action": action, "channel": channel, "client_name": client_name}
        )

    def _get(self, quote_id: str) -> dict:
        quote = self._quotes.get(quote_id)
        if quote is None:
            raise NotFoundError(f"Quote {quote_id} not found")
        return quote

    def _expired(self, quote: dict) -> bool:
        return self.clock() >= quote["expires_at"]

    def _active(self, quote_id: str) -> dict:
        quote = self._get(quote_id)
        if self._expired(quote):
            raise RuleError(f"Quote {quote_id} has expired. Create a new quote to re-price it.")
        return quote

    def _view(self, quote: dict) -> dict:
        return {
            "quote_id": quote["quote_id"],
            "status": "active",
            "destination": quote["destination"],
            "destination_region": quote["destination_region"],
            "start_date": quote["start_date"],
            "end_date": quote["end_date"],
            "trip_days": quote["trip_days"],
            "traveller_ages": quote["traveller_ages"],
            "tier": quote["tier"],
            "excess": quote["excess"],
            "packs": quote["packs"],
            "premium": quote["premium"],
            "medical_assessment_required": quote["medical_assessment_required"],
            "expires_at": quote["expires_at"].isoformat(),
            "channel": quote["channel"],
            "disclosure": disclosure(quote["tier"]),
            "catalogue_version": CATALOGUE_VERSION,
        }
