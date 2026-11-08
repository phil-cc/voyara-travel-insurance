"""Eligibility and tier-matching rules. Rules-based general advice only."""

from .catalogue import PACKS, TIER_NAMES, TIERS


class RuleError(ValueError):
    """A request that breaks a product rule. The message is safe to show to agents and customers."""

    def __init__(self, message: str, **details):
        super().__init__(message)
        self.details = details


MAX_AGE = 85
AGE_CAP_FROM = 75
AGE_CAP_TIER = "comprehensive"


def check_eligibility(traveller_ages: list[int]) -> dict:
    if not traveller_ages:
        raise RuleError("At least one traveller age is required")
    for age in traveller_ages:
        if age < 0 or age > 120:
            raise RuleError(f"Traveller age {age} is not valid")

    oldest = max(traveller_ages)
    ineligible: list[dict] = []
    if oldest > MAX_AGE:
        ineligible = [{"tier": t, "reason": f"Travellers aged {MAX_AGE + 1} or over are not eligible"} for t in TIERS]
        eligible: list[str] = []
    elif oldest >= AGE_CAP_FROM:
        cap = TIERS.index(AGE_CAP_TIER)
        eligible = TIERS[: cap + 1]
        ineligible = [
            {"tier": t, "reason": f"Travellers aged {AGE_CAP_FROM} or over can buy up to {TIER_NAMES[AGE_CAP_TIER]}"}
            for t in TIERS[cap + 1 :]
        ]
    else:
        eligible = list(TIERS)

    return {
        "eligible_tiers": eligible,
        "ineligible_tiers": ineligible,
        "highest_eligible_tier": eligible[-1] if eligible else None,
        "medical_assessment_required": oldest >= AGE_CAP_FROM,
    }


def assert_tier_eligible(tier: str, traveller_ages: list[int]) -> dict:
    result = check_eligibility(traveller_ages)
    if tier not in result["eligible_tiers"]:
        reason = next(i["reason"] for i in result["ineligible_tiers"] if i["tier"] == tier)
        raise RuleError(reason, highest_eligible_tier=result["highest_eligible_tier"])
    return result


def assert_pack_eligible(pack: str, tier: str) -> None:
    info = PACKS[pack]
    if tier not in info["eligible_tiers"]:
        raise RuleError(info["reason"], pack=pack, tier=tier)


ADVENTURE_ACTIVITIES = {"scuba", "skydiving", "trekking"}
SNOW_ACTIVITIES = {"skiing", "snowboarding"}
ACTIVITIES = sorted(ADVENTURE_ACTIVITIES | SNOW_ACTIVITIES)

RECOMMENDATION_NOTE = (
    "This matches the trip features you described to Voyara's policy rules. It is general advice and does "
    "not consider your personal circumstances."
)


def recommend_tier(
    activities: list[str],
    trip_cost: float,
    cruise: bool,
    rental_car: bool,
    ages: list[int],
    max_dive_depth_m: float | None = None,
    max_trek_altitude_m: float | None = None,
) -> dict:
    eligibility = check_eligibility(ages)
    if not eligibility["eligible_tiers"]:
        raise RuleError(eligibility["ineligible_tiers"][0]["reason"])

    needed = 0
    packs: list[str] = []
    rationale: list[str] = []
    warnings: list[str] = []

    def need(tier: str, why: str) -> None:
        nonlocal needed
        needed = max(needed, TIERS.index(tier))
        rationale.append(why)

    acts = set(activities)
    if acts & ADVENTURE_ACTIVITIES:
        need("explorer", "Adventure activities need Explorer or above with Adventure Pack. Essentials excludes them.")
        packs.append("adventure")
        if max_dive_depth_m is not None and max_dive_depth_m > 30:
            warnings.append("Adventure Pack covers scuba to 30 m only. Deeper dives are not covered.")
        if max_trek_altitude_m is not None and max_trek_altitude_m > 6000:
            warnings.append("Adventure Pack covers trekking to 6,000 m only. Higher treks are not covered.")
    if acts & SNOW_ACTIVITIES:
        need("explorer", "Snow sports need Explorer or above with Snow Pack.")
        packs.append("snow")
    if trip_cost > 20000:
        need("elite", "Prepaid costs above $20,000 need Elite, which lets you choose the cancellation limit.")
    elif trip_cost > 5000:
        need("comprehensive", "Prepaid costs above $5,000 need Comprehensive (cancellation to $20,000).")
    elif trip_cost > 0:
        need("explorer", "Cancellation cover starts at Explorer ($5,000).")
    if rental_car:
        need("comprehensive", "Rental vehicle excess is covered from Comprehensive ($5,000).")

    highest = TIERS.index(eligibility["highest_eligible_tier"])
    if needed > highest:
        warnings.append(
            f"Your trip needs exceed the highest tier available for these ages "
            f"({TIER_NAMES[TIERS[highest]]}). Some costs may not be fully covered."
        )
        needed = highest
    tier = TIERS[needed]

    if cruise:
        if tier == "elite":
            rationale.append("Elite includes cruise cover.")
        else:
            packs.append("cruise")
            rationale.append("Ocean cruises need Cruise Pack below Elite.")

    if not rationale:
        rationale.append("No trip features need more than Essentials, which covers overseas medical and evacuation.")
    if eligibility["medical_assessment_required"]:
        warnings.append("A medical assessment is required for travellers aged 75 or over. The traveller must answer it themselves.")

    return {
        "recommended_tier": tier,
        "packs": packs,
        "rationale": rationale,
        "warnings": warnings,
        "note": RECOMMENDATION_NOTE,
    }
