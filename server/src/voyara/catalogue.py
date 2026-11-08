"""Voyara product catalogue. All figures are fictitious and in AUD."""

from typing import Literal

CATALOGUE_VERSION = "2026-11-06"

Tier = Literal["essentials", "explorer", "comprehensive", "elite"]
Region = Literal["pacific", "asia", "worldwide_excl_americas", "worldwide"]
Pack = Literal["adventure", "snow", "cruise", "gadget"]

TIERS: list[str] = ["essentials", "explorer", "comprehensive", "elite"]
REGIONS: list[str] = ["pacific", "asia", "worldwide_excl_americas", "worldwide"]

TIER_NAMES = {
    "essentials": "Essentials",
    "explorer": "Explorer",
    "comprehensive": "Comprehensive",
    "elite": "Elite",
}

STANDARD_EXCESS = {"essentials": 250, "explorer": 200, "comprehensive": 100, "elite": 0}
EXCESS_OPTIONS = [0, 100, 200, 250, 500]

NC = "Not covered"

# inclusion key -> label, description, exclusions, PDS section, value per tier
INCLUSIONS: dict[str, dict] = {
    "overseas_medical": {
        "label": "Overseas medical and hospital",
        "description": "Reasonable overseas medical, hospital and surgical costs if you are injured or fall ill on your trip.",
        "exclusions": ["Treatment you planned before leaving", "Conditions not listed or assessed", "Private hospital if public care is available"],
        "pds_section": "Section 1",
        "values": ["$5m", "Unlimited", "Unlimited", "Unlimited"],
    },
    "emergency_evacuation": {
        "label": "Emergency evacuation",
        "description": "Getting you to the nearest suitable hospital or home when our medical team says it is necessary.",
        "exclusions": ["Evacuation not approved by our emergency assistance team"],
        "pds_section": "Section 1",
        "values": ["$250k", "Unlimited", "Unlimited", "Unlimited"],
    },
    "trip_cancellation": {
        "label": "Trip cancellation",
        "description": "Non-refundable prepaid costs if you must cancel or cut short your trip for a covered reason.",
        "exclusions": ["Changing your mind", "Events known when you bought the policy", "Airline or agent insolvency"],
        "pds_section": "Section 2",
        "values": [NC, "$5,000", "$20,000", "Unlimited (you choose)"],
    },
    "luggage": {
        "label": "Luggage and personal items",
        "description": "Repair or replacement of luggage and personal items lost, stolen or damaged on your trip.",
        "exclusions": ["Items left unattended in a public place", "Wear and tear", "Cash"],
        "pds_section": "Section 3",
        "values": [NC, "$3,000", "$10,000", "$20,000"],
    },
    "single_item_limit": {
        "label": "Single item limit",
        "description": "The most we pay for any one item, set or pair within luggage cover.",
        "exclusions": ["Items above the limit unless covered by Gadget Pack"],
        "pds_section": "Section 3",
        "values": [NC, "$500", "$1,000", "$3,000"],
    },
    "travel_delay": {
        "label": "Travel delay (after 6 hours)",
        "description": "Extra meals and accommodation when your scheduled transport is delayed by 6 hours or more.",
        "exclusions": ["Delays you knew about before departure", "Strikes announced before you bought the policy"],
        "pds_section": "Section 4",
        "values": [NC, "$500", "$2,000", "$4,000"],
    },
    "rental_vehicle_excess": {
        "label": "Rental vehicle excess",
        "description": "The excess you must pay the rental company if your rental car is damaged or stolen.",
        "exclusions": ["Breaching the rental agreement", "Unsealed roads", "Motorcycles"],
        "pds_section": "Section 5",
        "values": [NC, NC, "$5,000", "$10,000"],
    },
    "missed_connection": {
        "label": "Missed connection",
        "description": "Extra costs to reach a prepaid connection, wedding or event you miss due to a covered delay.",
        "exclusions": ["Connections booked with less than 3 hours between them"],
        "pds_section": "Section 4",
        "values": [NC, NC, "$1,500", "$3,000"],
    },
    "pre_existing_conditions": {
        "label": "Pre-existing conditions",
        "description": "Cover for medical conditions you had before buying the policy.",
        "exclusions": ["Conditions not on the listed set and not assessed", "Travelling against medical advice"],
        "pds_section": "Section 6",
        "values": ["Listed conditions only", "Listed conditions only", "Assessed conditions", "Assessed conditions, higher limits"],
    },
    "cruise_cover": {
        "label": "Cruise cover",
        "description": "Cabin confinement, missed ports and ship medical costs on ocean cruises.",
        "exclusions": ["River cruises are covered without the pack"],
        "pds_section": "Section 7",
        "values": ["Add-on", "Add-on", "Add-on", "Included"],
    },
    "emergency_assistance": {
        "label": "24/7 emergency assistance",
        "description": "Round-the-clock help from our emergency team wherever you are.",
        "exclusions": [],
        "pds_section": "Section 8",
        "values": ["Yes", "Yes", "Yes", "Yes, plus concierge"],
    },
    "standard_excess": {
        "label": "Standard excess",
        "description": "The amount you pay towards each claim. You can choose a different excess when quoting.",
        "exclusions": [],
        "pds_section": "Section 9",
        "values": ["$250", "$200", "$100", "$0"],
    },
    "domestic_trips": {
        "label": "Domestic trips",
        "description": "Whether the tier can cover trips within Australia.",
        "exclusions": [],
        "pds_section": "Section 10",
        "values": ["No", "Yes", "Yes", "Yes"],
    },
}

PACKS: dict[str, dict] = {
    "adventure": {
        "name": "Adventure Pack",
        "covers": "Scuba to 30 m, skydiving, trekking to 6,000 m",
        "price": 49,
        "eligible_tiers": ["explorer", "comprehensive", "elite"],
        "reason": "Adventure Pack requires Explorer or above",
    },
    "snow": {
        "name": "Snow Pack",
        "covers": "Skiing, snowboarding, piste closure, ski hire",
        "price": 79,
        "eligible_tiers": ["explorer", "comprehensive", "elite"],
        "reason": "Snow Pack requires Explorer or above",
    },
    "cruise": {
        "name": "Cruise Pack",
        "covers": "Cabin confinement, missed port, ship medical",
        "price": 89,
        "eligible_tiers": ["essentials", "explorer", "comprehensive"],
        "reason": "Cruise Pack is not available on Elite because cruise cover is already included",
    },
    "gadget": {
        "name": "Gadget Pack",
        "covers": "Phones, laptops, cameras to $4,000",
        "price": 39,
        "eligible_tiers": ["comprehensive", "elite"],
        "reason": "Gadget Pack requires Comprehensive or above",
    },
}

PDS_BASE_URL = "https://voyara.com.au/pds"
TMD_URL = "https://voyara.com.au/tmd"

GENERAL_ADVICE_WARNING = (
    "This is general advice only and does not take into account your objectives, financial situation "
    "or needs. Read the Product Disclosure Statement (PDS) and Target Market Determination (TMD) "
    "before deciding whether this product is right for you."
)

TMD_TEXT = (
    "Voyara Target Market Determination (fictitious). This product is designed for Australian residents "
    "aged 85 or under travelling overseas (or domestically on Explorer and above) who want cover for "
    "medical emergencies and, depending on tier, trip cancellation, luggage and travel delay. It is not "
    "suitable for people who need cover for pre-existing conditions that have not been listed or assessed, "
    "or for travellers aged 86 or over. Travellers aged 75 to 85 can buy up to Comprehensive."
)


def disclosure(tier: str | None = None) -> dict:
    return {
        "general_advice_warning": GENERAL_ADVICE_WARNING,
        "pds_url": f"{PDS_BASE_URL}/{tier}" if tier else PDS_BASE_URL,
        "tmd_url": TMD_URL,
    }


def tier_value(inclusion: str, tier: str) -> str:
    return INCLUSIONS[inclusion]["values"][TIERS.index(tier)]


def pds_section_text(tier: str) -> str:
    lines = [f"Voyara {TIER_NAMES[tier]} - Product Disclosure Statement extract (fictitious)", ""]
    for key, inc in INCLUSIONS.items():
        lines.append(f"{inc['pds_section']} - {inc['label']}: {tier_value(key, tier)}")
        lines.append(f"  {inc['description']}")
        if inc["exclusions"]:
            lines.append(f"  Key exclusions: {'; '.join(inc['exclusions'])}")
    packs = [p["name"] for p in PACKS.values() if tier in p["eligible_tiers"]]
    lines += ["", f"Available add-on packs: {', '.join(packs)}"]
    return "\n".join(lines)
