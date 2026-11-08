"""Premium calculation. The constants are invented and tuned so PRD Story 1 prices at $312."""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from .catalogue import PACKS, STANDARD_EXCESS

TIER_RATES = {  # (base per traveller, daily rate per traveller)
    "essentials": (Decimal(35), Decimal(7)),
    "explorer": (Decimal(53), Decimal(10)),
    "comprehensive": (Decimal(107), Decimal(12)),
    "elite": (Decimal(159), Decimal(16)),
}

REGION_FACTORS = {
    "pacific": Decimal("0.85"),
    "asia": Decimal("1.00"),
    "worldwide_excl_americas": Decimal("1.35"),
    "worldwide": Decimal("1.70"),
}

AGE_BANDS = [  # (upper age inclusive, loading)
    (17, Decimal("0.50")),
    (34, Decimal("1.00")),
    (54, Decimal("1.15")),
    (64, Decimal("1.50")),
    (74, Decimal("2.10")),
    (85, Decimal("3.20")),
]

EXCESS_STEP = Decimal("0.0004")  # premium change per dollar of excess below or above the tier standard
CENT = Decimal("0.01")


def trip_days(start: date, end: date) -> int:
    return (end - start).days + 1


def age_loading(age: int) -> Decimal:
    for upper, loading in AGE_BANDS:
        if age <= upper:
            return loading
    raise ValueError(f"No age band for age {age}")


def excess_factor(tier: str, excess: int) -> Decimal:
    return 1 + (STANDARD_EXCESS[tier] - excess) * EXCESS_STEP


def price(region: str, days: int, ages: list[int], tier: str, excess: int, packs: list[str]) -> dict:
    """Premium breakdown. Amounts are strings with two decimal places so they survive JSON exactly."""
    base, daily = TIER_RATES[tier]
    per_trip = (base + daily * days) * REGION_FACTORS[region] * excess_factor(tier, excess)
    travellers = [
        {"age": age, "amount": (per_trip * age_loading(age)).quantize(CENT, ROUND_HALF_UP)} for age in ages
    ]
    pack_lines = [{"pack": p, "amount": Decimal(PACKS[p]["price"]).quantize(CENT)} for p in packs]
    total = sum((t["amount"] for t in travellers), Decimal(0)) + sum((p["amount"] for p in pack_lines), Decimal(0))
    return {
        "currency": "AUD",
        "travellers": [{"age": t["age"], "amount": str(t["amount"])} for t in travellers],
        "packs": [{"pack": p["pack"], "amount": str(p["amount"])} for p in pack_lines],
        "total": str(total.quantize(CENT)),
    }
