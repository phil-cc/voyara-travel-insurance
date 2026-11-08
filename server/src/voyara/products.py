"""Read-only catalogue views shared by the MCP tools and the REST API."""

from . import pricing
from .catalogue import CATALOGUE_VERSION, INCLUSIONS, PACKS, STANDARD_EXCESS, TIER_NAMES, TIERS, disclosure, tier_value
from .rules import RuleError

HEADLINE_INCLUSIONS = ["overseas_medical", "trip_cancellation", "luggage", "standard_excess"]
STARTING_PRICE_BASIS = "One traveller aged 18 to 34, 7 days in the Pacific, standard excess"


def list_policy_tiers() -> dict:
    tiers = []
    for tier in TIERS:
        start = pricing.price("pacific", 7, [30], tier, STANDARD_EXCESS[tier], [])["total"]
        tiers.append(
            {
                "tier": tier,
                "name": TIER_NAMES[tier],
                "headline_limits": {INCLUSIONS[k]["label"]: tier_value(k, tier) for k in HEADLINE_INCLUSIONS},
                "available_packs": [p for p, info in PACKS.items() if tier in info["eligible_tiers"]],
                "starting_price": start,
            }
        )
    return {
        "tiers": tiers,
        "starting_price_basis": STARTING_PRICE_BASIS,
        "disclosure": disclosure(),
        "catalogue_version": CATALOGUE_VERSION,
    }


def compare_tiers(tiers: list[str], inclusions: list[str] | None = None) -> dict:
    tiers = [t for t in TIERS if t in set(tiers)]  # catalogue order, de-duplicated
    if not tiers:
        raise RuleError("Choose at least one tier to compare")
    keys = inclusions or list(INCLUSIONS)
    for key in keys:
        if key not in INCLUSIONS:
            raise RuleError(f"Unknown inclusion '{key}'")
    return {
        "tiers": tiers,
        "matrix": [
            {"inclusion": k, "label": INCLUSIONS[k]["label"], **{t: tier_value(k, t) for t in tiers}} for k in keys
        ],
        "catalogue_version": CATALOGUE_VERSION,
    }


def explain_inclusion(inclusion: str, tier: str) -> dict:
    if inclusion not in INCLUSIONS:
        raise RuleError(f"Unknown inclusion '{inclusion}'")
    if tier not in TIERS:
        raise RuleError(f"Unknown tier '{tier}'")
    info = INCLUSIONS[inclusion]
    return {
        "inclusion": inclusion,
        "label": info["label"],
        "tier": tier,
        "limit": tier_value(inclusion, tier),
        "description": info["description"],
        "exclusions": info["exclusions"],
        "pds_section": info["pds_section"],
        "pds_url": disclosure(tier)["pds_url"],
        "catalogue_version": CATALOGUE_VERSION,
    }
