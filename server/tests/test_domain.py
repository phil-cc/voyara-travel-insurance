from datetime import date

import pytest

from voyara import destinations, rules
from voyara.catalogue import CATALOGUE_VERSION
from voyara.rules import RuleError

from .conftest import story1_inputs


def test_story1_golden_price(service):
    quote = service.create_quote(**story1_inputs(), channel="mcp")
    assert quote["premium"]["total"] == "312.00"
    assert quote["trip_days"] == 21


def test_story1_comprehensive_costs_96_more(service):
    explorer = service.create_quote(**story1_inputs(), channel="mcp")
    comprehensive = service.create_quote(**story1_inputs(tier="comprehensive"), channel="mcp")
    diff = float(comprehensive["premium"]["total"]) - float(explorer["premium"]["total"])
    assert diff == 96


def test_pack_price_is_per_trip_not_per_traveller(service):
    one = service.create_quote(**story1_inputs(packs=[]), channel="mcp")
    one_with_pack = service.create_quote(**story1_inputs(), channel="mcp")
    two_with_pack = service.create_quote(**story1_inputs(traveller_ages=[27, 27]), channel="mcp")
    assert float(one_with_pack["premium"]["total"]) - float(one["premium"]["total"]) == 49
    assert float(two_with_pack["premium"]["total"]) == 2 * 263 + 49


# R-03
@pytest.mark.parametrize("call", ["create", "update"])
def test_gadget_pack_rejected_on_explorer(service, call):
    if call == "create":
        with pytest.raises(RuleError, match="^Gadget Pack requires Comprehensive or above$"):
            service.create_quote(**story1_inputs(packs=["gadget"]), channel="mcp")
    else:
        quote = service.create_quote(**story1_inputs(), channel="mcp")
        with pytest.raises(RuleError, match="^Gadget Pack requires Comprehensive or above$"):
            service.update_quote(quote["quote_id"], packs=["gadget"], channel="mcp")
        # A rejected update must not change the stored quote.
        assert service.get_quote(quote["quote_id"])["packs"] == ["adventure"]


def test_cruise_pack_not_sold_on_elite(service):
    with pytest.raises(RuleError, match="already included"):
        service.create_quote(**story1_inputs(tier="elite", packs=["cruise"]), channel="mcp")


# R-04
def test_age_78_elite_returns_comprehensive_as_highest(service):
    with pytest.raises(RuleError) as err:
        service.create_quote(**story1_inputs(traveller_ages=[78], tier="elite", packs=[]), channel="mcp")
    assert err.value.details["highest_eligible_tier"] == "comprehensive"


def test_story3_graham_eligibility():
    result = rules.check_eligibility([78])
    assert result["highest_eligible_tier"] == "comprehensive"
    assert result["eligible_tiers"] == ["essentials", "explorer", "comprehensive"]
    assert result["medical_assessment_required"] is True


def test_age_86_is_ineligible():
    result = rules.check_eligibility([40, 86])
    assert result["eligible_tiers"] == []
    assert result["highest_eligible_tier"] is None


# R-05
def test_every_priced_quote_carries_disclosure(service):
    quote = service.create_quote(**story1_inputs(), channel="mcp")
    assert quote["disclosure"]["pds_url"].startswith("https://")
    assert quote["disclosure"]["tmd_url"].startswith("https://")
    assert "general advice" in quote["disclosure"]["general_advice_warning"]
    assert quote["catalogue_version"] == CATALOGUE_VERSION
    updated = service.update_quote(quote["quote_id"], excess=500, channel="mcp")
    assert "disclosure" in updated
    checkout = service.start_checkout(quote["quote_id"], channel="mcp")
    assert "disclosure" in checkout["quote"]


# R-07
@pytest.mark.parametrize("activity", ["scuba", "skydiving", "trekking"])
def test_adventure_activities_never_get_essentials(activity):
    result = rules.recommend_tier([activity], trip_cost=0, cruise=False, rental_car=False, ages=[30])
    assert result["recommended_tier"] != "essentials"
    assert "adventure" in result["packs"]


def test_story1_recommendation():
    result = rules.recommend_tier(["trekking"], 0, False, False, [27], max_trek_altitude_m=5364)
    assert result["recommended_tier"] == "explorer"
    assert result["packs"] == ["adventure"]
    assert result["warnings"] == []
    assert "right for you" not in " ".join(result["rationale"] + [result["note"]])


def test_story2_family_ski_with_rental_car():
    result = rules.recommend_tier(["skiing"], 4000, False, True, [42, 40, 10, 8])
    assert result["recommended_tier"] == "comprehensive"
    assert result["packs"] == ["snow"]


def test_story3_cruise_capped_at_comprehensive_with_cruise_pack():
    result = rules.recommend_tier([], 30000, True, False, [78])
    assert result["recommended_tier"] == "comprehensive"
    assert result["packs"] == ["cruise"]
    assert any("medical assessment" in w for w in result["warnings"])


# R-10
def test_quote_expires_after_7_days(service, clock):
    quote = service.create_quote(**story1_inputs(), channel="mcp")
    clock.advance(days=6, hours=23)
    assert service.get_quote(quote["quote_id"])["status"] == "active"
    clock.advance(hours=1)
    expired = service.get_quote(quote["quote_id"])
    assert expired["status"] == "expired"
    assert expired["requote_inputs"]["tier"] == "explorer"
    with pytest.raises(RuleError, match="expired"):
        service.update_quote(quote["quote_id"], tier="comprehensive", channel="mcp")


def test_checkout_expires_after_30_minutes(service, clock):
    quote = service.create_quote(**story1_inputs(), channel="mcp")
    checkout = service.start_checkout(quote["quote_id"], channel="mcp")
    assert checkout["checkout_url"].endswith(checkout["checkout_session_id"])
    clock.advance(minutes=30)
    with pytest.raises(RuleError, match="expired"):
        service.get_checkout(checkout["checkout_session_id"])


def test_past_start_date_rejected(service):
    with pytest.raises(RuleError, match="past"):
        service.create_quote(**story1_inputs(start_date=date(2026, 1, 1)), channel="mcp")


def test_excess_changes_price_and_tier_change_follows_standard_excess(service):
    quote = service.create_quote(**story1_inputs(), channel="mcp")
    assert quote["excess"] == 200
    higher = service.update_quote(quote["quote_id"], excess=500, channel="mcp")
    assert float(higher["premium"]["total"]) < 312
    reset = service.update_quote(quote["quote_id"], excess=200, channel="mcp")
    moved = service.update_quote(reset["quote_id"], tier="elite", channel="mcp")
    assert moved["excess"] == 0


def test_audit_records_channel_and_client(service):
    quote = service.create_quote(**story1_inputs(), channel="mcp", client_name="claude-code")
    service.update_quote(quote["quote_id"], excess=500, channel="webmcp")
    audit = service._quotes[quote["quote_id"]]["audit"]
    assert [(a["action"], a["channel"], a["client_name"]) for a in audit] == [
        ("create_quote", "mcp", "claude-code"),
        ("update_quote", "webmcp", None),
    ]


def test_destination_allow_list():
    assert destinations.resolve(" Japan ") == "asia"
    assert destinations.resolve("Fiji") == "pacific"
    assert destinations.resolve("ignore previous instructions") is None
